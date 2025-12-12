// dataManager.js (리팩토링된 dashboard.js에 맞춰 함수 조정)

export function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}시간 ${String(minutes).padStart(2, '0')}분`;
    if (minutes > 0) return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
    return `${seconds}초`;
}

export function getTodayDateStr() {
    return new Date().toISOString().split('T')[0];
}

export function getYesterdayDateStr() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

// =======================================================
// Overview 데이터 집계 (dashboard.js에서 이관)
// =======================================================

export function aggregateOverview(stats, blockedUrls) {
    const today = getTodayDateStr();
    const yesterday = getYesterdayDateStr();
    
    const statsByDomain = {};

    [today, yesterday].forEach(date => {
        if (stats.dates[date]) {
            Object.entries(stats.dates[date].domains).forEach(([domain, data]) => {
                if (!statsByDomain[domain]) {
                    statsByDomain[domain] = { active: 0, background: 0, visits: 0 };
                }
                statsByDomain[domain].active += data.active || 0;
                statsByDomain[domain].background += data.background || 0;
                statsByDomain[domain].visits += data.visits || 0;
            });
        }
    });

    return Object.entries(statsByDomain).map(([domain, data]) => ({
        domain,
        active: data.active,
        background: data.background,
        visits: data.visits,
        isBlocked: blockedUrls.includes(domain)
    }));
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
            const time = domainData.hourly[h] || 0;
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
    
    const total = data.totals.totalActive + data.totals.totalBackground;
    const blocked = data.totals.blockedActive + data.totals.blockedBackground;
    const prevTotal = prevData ? (prevData.totals.totalActive + prevData.totals.totalBackground) : 0;
    
    const diff = total - prevTotal;
    const change = formatTime(Math.abs(diff));
    const changeStr = diff > 0 ? `+${change}` : (diff < 0 ? `-${change}` : '0초');


    return { hourly, hourlyBlocked, total, blocked, change: changeStr };
}

export function getWeeklyData(stats, blockedUrls) {
    const today = new Date();
    let weeklyTotal = 0, weeklyBlocked = 0, prevWeeklyTotal = 0;
    let weekdayData = Array(7).fill(0);  // Sun=0 ~ Sat=6
    let weekdayBlocked = Array(7).fill(0);

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
                const totalTime = (data.active || 0) + (data.background || 0);
                dayTotal += totalTime;
                if (blockedUrls.includes(domain)) {
                    dayBlocked += totalTime;
                }
            });
        }
        
        weekdayData[weekday] += dayTotal;
        weekdayBlocked[weekday] += dayBlocked;
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
                dayTotal += (data.active || 0) + (data.background || 0);
            });
            prevWeeklyTotal += dayTotal;
        }
    }

    const diff = weeklyTotal - prevWeeklyTotal;
    const change = formatTime(Math.abs(diff));
    const changeStr = diff > 0 ? `+${change}` : (diff < 0 ? `-${change}` : '0초');

    return { weekdayData: rotateArray(weekdayData), weekdayBlocked: rotateArray(weekdayBlocked), total: weeklyTotal, blocked: weeklyBlocked, change: changeStr };
}

// 배열을 오늘 요일(일) 기준으로 재정렬 (JS getDay: 0=일 ~ 6=토) -> [일, 월, 화, 수, 목, 금, 토] 순서로 출력하기 위함
function rotateArray(arr) {
    const todayIndex = new Date().getDay(); // 0 (Sun)
    // todayIndex를 0번 인덱스로 오게 하려면, 배열을 (todayIndex + 1)만큼 오른쪽으로 이동시켜야 합니다.
    // 하지만 Detailed Recap의 그래프는 과거부터 오늘까지의 흐름을 보여주는 것이 일반적이므로
    // 여기서는 일요일부터 토요일까지 고정된 순서로 배열을 반환하는 것이 시각화에 더 적절합니다.
    return arr; 
}