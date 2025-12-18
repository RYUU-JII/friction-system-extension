// dataManager.js

import { ensureNumber, formatTime, getLocalDateStr, getTodayDateStr, getYesterdayDateStr } from './utils/utils.js';

// =======================================================
// Overview 데이터 집계 (Top N 및 변화량 계산 로직으로 대체)
// 이 함수는 Top 10, Top 5 증가, Top 5 감소 리스트를 반환합니다.
// =======================================================

export function aggregateOverview(stats, blockedUrls) {
    const todayStr = getTodayDateStr();
    const yesterdayStr = getYesterdayDateStr();
    
    // 특정 날짜의 도메인별 시간 데이터를 모두 계산하는 헬퍼 함수
    const getAllTimeData = (dateStr) => {
        const data = {};
        if (stats.dates[dateStr]) {
            Object.entries(stats.dates[dateStr].domains).forEach(([domain, domainData]) => {
                data[domain] = {
                    activeTime: (domainData.active || 0),
                    backgroundTime: (domainData.background || 0)
                };
            });
        }
        return data;
    };

    const todayData = getAllTimeData(todayStr);
    const yesterdayData = getAllTimeData(yesterdayStr);
    
    const allDomains = new Set([
        ...Object.keys(todayData), 
        ...Object.keys(yesterdayData)
    ]);

    const changeData = [];
    const todayForegroundRecap = []; // 포그라운드(활성 탭) 기준
    const todayBackgroundRecap = []; // 백그라운드 사용 시간 기준 (NEW)

    allDomains.forEach(domain => {
        const todayActiveTime = todayData[domain]?.activeTime || 0;
        const yesterdayActiveTime = yesterdayData[domain]?.activeTime || 0;
        const todayBgTime = todayData[domain]?.backgroundTime || 0; // 백그라운드 시간
        const diff = todayActiveTime - yesterdayActiveTime;
        const isBlocked = blockedUrls.includes(domain);

        // 1. 포그라운드 사용 시간 Recap (Top 5 Today)
        if (todayActiveTime > 0) {
            todayForegroundRecap.push({
                domain,
                totalTime: todayActiveTime,
                isBlocked
            });
        }

        // 2. 백그라운드 시간 Recap (Top 5 Background)
        if (todayBgTime > 0) {
            todayBackgroundRecap.push({
                domain,
                totalTime: todayBgTime, // 필드명은 totalTime으로 통일하여 재활용
                isBlocked
            });
        }
        
        // 3. 변화량 Recap (Top 5 Increase/Decrease, 포그라운드 기준)
        if (todayActiveTime > 0 || yesterdayActiveTime > 0) {
            changeData.push({
                domain,
                diff, 
                todayTime: todayActiveTime,
                yesterdayTime: yesterdayActiveTime,
                isBlocked
            });
        }
    });

    // 1. Top 5 Foreground (Today)
    todayForegroundRecap.sort((a, b) => b.totalTime - a.totalTime);
    const topUsed = todayForegroundRecap.slice(0, 5).map(item => ({
        ...item,
        timeStr: formatTime(item.totalTime)
    }));

    // 2. Top 5 Background
    todayBackgroundRecap.sort((a, b) => b.totalTime - a.totalTime);
    const top5Background = todayBackgroundRecap.slice(0, 5).map(item => ({
        ...item,
        timeStr: formatTime(item.totalTime)
    }));

    // 2. Top 5 Increase (diff가 양수인 것 중 상위 5개)
    changeData.sort((a, b) => b.diff - a.diff);
    const top5Increase = changeData.filter(item => item.diff > 0).slice(0, 5).map(item => ({
        ...item,
        diffStr: formatTime(item.diff), // '시간' 형태로 포맷
        todayStr: formatTime(item.todayTime),
        yesterdayStr: formatTime(item.yesterdayTime)
    }));
    
    // 3. Top 5 Decrease (diff가 음수인 것 중 하위 5개)
    changeData.sort((a, b) => a.diff - b.diff);
    const top5Decrease = changeData.filter(item => item.diff < 0).slice(0, 5).map(item => ({
        ...item,
        // 음수이므로 Math.abs 처리 후 '-' 기호 추가
        diffStr: `-${formatTime(Math.abs(item.diff))}`, 
        todayStr: formatTime(item.todayTime),
        yesterdayStr: formatTime(item.yesterdayTime)
    }));

    return {
        topUsed,
        top5Background,
        top5Increase,
        top5Decrease,
    };
}


// =======================================================
// Detailed Recap 데이터 집계 (안정성 보강)
// =======================================================

function getDomainsForDate(stats, dateStr) {
    const dates = stats && typeof stats === 'object' ? stats.dates : null;
    const day = dates && typeof dates === 'object' ? dates[dateStr] : null;
    const domains = day && typeof day === 'object' ? day.domains : null;
    return domains && typeof domains === 'object' ? domains : {};
}

function toBlockedSet(blockedUrls) {
    return new Set(Array.isArray(blockedUrls) ? blockedUrls : []);
}

function ensure24Array(val) {
    const out = Array(24).fill(0);

    if (Array.isArray(val)) {
        for (let i = 0; i < 24; i++) out[i] = Math.max(0, ensureNumber(val[i]));
        return out;
    }

    if (val && typeof val === 'object') {
        for (let i = 0; i < 24; i++) out[i] = Math.max(0, ensureNumber(val[i] ?? val[String(i)]));
        return out;
    }

    return out;
}

function parseLocalDateStr(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function shiftLocalDateStr(dateStr, deltaDays) {
    const base = parseLocalDateStr(dateStr) || new Date();
    base.setDate(base.getDate() + ensureNumber(deltaDays));
    return getLocalDateStr(base.getTime());
}

function reconcileHourlyToTotal(hourly, totalMs) {
    const target = Math.max(0, ensureNumber(totalMs));
    const base = ensure24Array(hourly);
    const sum = base.reduce((acc, v) => acc + v, 0);

    if (sum === target) return base;

    if (sum <= 0) {
        if (target <= 0) return base;
        const per = Math.floor(target / 24);
        const rem = target - per * 24;
        const out = Array(24).fill(per);
        for (let i = 0; i < rem; i++) out[i] += 1;
        return out;
    }

    const scale = target / sum;
    const scaled = base.map((v) => Math.floor(v * scale));
    const scaledSum = scaled.reduce((acc, v) => acc + v, 0);
    let rem = target - scaledSum;
    if (rem <= 0) return scaled;

    const frac = base
        .map((v, idx) => ({ idx, frac: v * scale - Math.floor(v * scale) }))
        .sort((a, b) => b.frac - a.frac);

    for (let i = 0; i < frac.length && rem > 0; i++, rem--) {
        scaled[frac[i].idx] += 1;
    }

    return scaled;
}

function getDomainHourlyActive(domainData) {
    const active = Math.max(0, ensureNumber(domainData?.active));

    if (Array.isArray(domainData?.hourlyActive) && domainData.hourlyActive.length === 24) {
        return reconcileHourlyToTotal(domainData.hourlyActive, active);
    }

    // Legacy: hourly might include background; estimate active by ratio.
    const rawHourly = ensure24Array(domainData?.hourly);
    const background = Math.max(0, ensureNumber(domainData?.background));
    const sum = active + background;
    const ratio = sum > 0 ? active / sum : 0;
    const approx = rawHourly.map((v) => Math.round(v * ratio));
    return reconcileHourlyToTotal(approx, active);
}

function isDisplayableDomain(domain) {
    const d = String(domain ?? '').trim();
    if (!d) return false;
    if (d === 'null' || d === 'undefined') return false;
    if (d.includes(' ')) return false;
    if (d.includes('/') || d.includes(':')) return false;
    if (d === 'localhost') return true;
    return d.includes('.');
}

function pushTopN(list, item, n) {
    if (!list || !item || item.time <= 0) return;
    let inserted = false;
    for (let i = 0; i < list.length; i++) {
        if (item.time > list[i].time) {
            list.splice(i, 0, item);
            inserted = true;
            break;
        }
    }
    if (!inserted) list.push(item);
    if (list.length > n) list.length = n;
}

export function getDailyData(stats, dateStr, blockedUrls) {
    const domains = getDomainsForDate(stats, dateStr);
    const blockedSet = toBlockedSet(blockedUrls);

    const hourly = Array(24).fill(0);
    const hourlyBlocked = Array(24).fill(0);
    const topByHour = Array.from({ length: 24 }, () => []);

    let total = 0;
    let blocked = 0;

    for (const [domain, domainData] of Object.entries(domains)) {
        const activeTotal = Math.max(0, ensureNumber(domainData?.active));
        if (activeTotal > 0) total += activeTotal;

        const isBlocked = blockedSet.has(domain);
        if (isBlocked && activeTotal > 0) blocked += activeTotal;

        const hourlyActive = getDomainHourlyActive(domainData);
        for (let h = 0; h < 24; h++) {
            const t = Math.max(0, ensureNumber(hourlyActive[h]));
            if (t <= 0) continue;
            hourly[h] += t;
            if (isBlocked) hourlyBlocked[h] += t;
            if (isDisplayableDomain(domain)) {
                pushTopN(topByHour[h], { domain, time: t }, 3);
            }
        }
    }

    const prevDateStr = shiftLocalDateStr(dateStr, -1);
    const prevDomains = getDomainsForDate(stats, prevDateStr);
    let prevTotal = 0;
    for (const d of Object.values(prevDomains)) {
        prevTotal += Math.max(0, ensureNumber(d?.active));
    }

    const diff = total - prevTotal;
    const change = formatTime(Math.abs(diff));
    const changeStr = diff > 0 ? `+${change}` : (diff < 0 ? `-${change}` : '0초');

    return { hourly, hourlyBlocked, total, blocked, change: changeStr, dateStr, topByHour };
}

export function getWeeklyData(stats, blockedUrls) {
    const today = new Date();
    const blockedSet = toBlockedSet(blockedUrls);
    let weeklyTotal = 0, weeklyBlocked = 0, prevWeeklyTotal = 0;
    let weekdayData = Array(7).fill(0);  // Sun=0 ~ Sat=6
    let weekdayBlocked = Array(7).fill(0);
    let weekdayDateStr = Array(7).fill('');

    // 지난 7일 데이터 (이번 주 데이터)
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = getLocalDateStr(date.getTime());
        const weekday = date.getDay();

        let dayTotal = 0;
        let dayBlocked = 0;

        const domains = getDomainsForDate(stats, dateStr);
        Object.entries(domains).forEach(([domain, data]) => {
            const activeTime = Math.max(0, ensureNumber(data?.active));
            dayTotal += activeTime;
            if (blockedSet.has(domain)) dayBlocked += activeTime;
        });
        
        weekdayData[weekday] += dayTotal;
        weekdayBlocked[weekday] += dayBlocked;
        weekdayDateStr[weekday] = dateStr;
        weeklyTotal += dayTotal;
        weeklyBlocked += dayBlocked;
    }

    // 지난 7일 데이터 (지난 주 데이터)
    for (let i = 7; i < 14; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = getLocalDateStr(date.getTime());
        const domains = getDomainsForDate(stats, dateStr);
        let dayTotal = 0;
        Object.entries(domains).forEach(([, data]) => {
            dayTotal += Math.max(0, ensureNumber(data?.active));
        });
        prevWeeklyTotal += dayTotal;
    }

    const diff = weeklyTotal - prevWeeklyTotal;
    const change = formatTime(Math.abs(diff));
    const changeStr = diff > 0 ? `+${change}` : (diff < 0 ? `-${change}` : '0초');

    return {
        weekdayData: rotateArray(weekdayData),
        weekdayBlocked: rotateArray(weekdayBlocked),
        weekdayDateStr: rotateArray(weekdayDateStr),
        total: weeklyTotal,
        blocked: weeklyBlocked,
        change: changeStr
    };
}

// 배열을 오늘 요일(일) 기준으로 재정렬 (JS getDay: 0=일 ~ 6=토) -> [일, 월, 화, 수, 목, 금, 토] 순서로 출력하기 위함
function rotateArray(arr) {
    const todayIndex = new Date().getDay(); // 0 (Sun)
    // todayIndex를 0번 인덱스로 오게 하려면, 배열을 (todayIndex + 1)만큼 오른쪽으로 이동시켜야 합니다.
    // 하지만 Detailed Recap의 그래프는 과거부터 오늘까지의 흐름을 보여주는 것이 일반적이므로
    // 여기서는 일요일부터 토요일까지 고정된 순서로 배열을 반환하는 것이 시각화에 더 적절합니다.
    return arr; 
}
