// dataManager.js

import { getTodayDateStr, getYesterdayDateStr, formatTime } from './utils/utils.js';

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

export function getDailyData(stats, dateStr, blockedUrls) {
    const data = stats.dates[dateStr] || { totals: { totalActive: 0, totalBackground: 0, blockedActive: 0, blockedBackground: 0 }, hourly: {}, domains: {} };
    const domains = data.domains;
    
    // 시간별 총 사용량 및 차단 사용량 계산
    let hourly = Array(24).fill(0);
    let hourlyBlocked = Array(24).fill(0);
    
    for (let h = 0; h < 24; h++) {
        Object.entries(domains).forEach(([domain, domainData]) => {
            const hasHourlyActive = Array.isArray(domainData.hourlyActive) && domainData.hourlyActive.length === 24;
            const rawHour = hasHourlyActive ? (domainData.hourlyActive[h] || 0) : (domainData.hourly?.[h] || 0);

            // 기존 데이터는 hourly에 background가 섞여있어 비율로 보정(근사)해 포그라운드만 추정합니다.
            const active = domainData.active || 0;
            const background = domainData.background || 0;
            const sum = active + background;
            const ratio = sum > 0 ? (active / sum) : 0;
            const time = hasHourlyActive ? rawHour : Math.round(rawHour * ratio);

            hourly[h] += time;
            if (blockedUrls.includes(domain)) {
                hourlyBlocked[h] += time;
            }
        });
    }

    // 전일 데이터 비교
    const date = new Date(dateStr);
    date.setDate(date.getDate() - 1);
    const prevDateStr = date.toISOString().split('T')[0];
    const prevData = stats.dates[prevDateStr];
    
    // 총합은 포그라운드(Active)만 표시합니다.
    const total = data.totals.totalActive || 0;
    const blocked = data.totals.blockedActive || 0;
    const prevTotal = prevData ? (prevData.totals.totalActive || 0) : 0;
    
    const diff = total - prevTotal;
    const change = formatTime(Math.abs(diff));
    const changeStr = diff > 0 ? `+${change}` : (diff < 0 ? `-${change}` : '0초');


    return { hourly, hourlyBlocked, total, blocked, change: changeStr, dateStr };
}

export function getWeeklyData(stats, blockedUrls) {
    const today = new Date();
    let weeklyTotal = 0, weeklyBlocked = 0, prevWeeklyTotal = 0;
    let weekdayData = Array(7).fill(0);  // Sun=0 ~ Sat=6
    let weekdayBlocked = Array(7).fill(0);
    let weekdayDateStr = Array(7).fill('');

    // 지난 7일 데이터 (이번 주 데이터)
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const weekday = date.getDay();

        let dayTotal = 0;
        let dayBlocked = 0;

        if (stats.dates[dateStr]) {
             Object.entries(stats.dates[dateStr].domains).forEach(([domain, data]) => {
                const activeTime = (data.active || 0);
                dayTotal += activeTime;
                if (blockedUrls.includes(domain)) {
                    dayBlocked += activeTime;
                }
            });
        }
        
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
        const dateStr = date.toISOString().split('T')[0];
        if (stats.dates[dateStr]) {
            let dayTotal = 0;
             Object.entries(stats.dates[dateStr].domains).forEach(([domain, data]) => {
                dayTotal += (data.active || 0);
            });
            prevWeeklyTotal += dayTotal;
        }
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
