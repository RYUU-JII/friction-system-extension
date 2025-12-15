// timeUtils.js

/**
 * 유효한 숫자인지 확인하는 헬퍼 함수
 */
export const ensureNumber = (val) => (typeof val === 'number' && !isNaN(val) ? val : 0);

/**
 * 1. 시간 포맷팅 유틸리티 (from dataManager.js)
 * 밀리초(ms)를 'X시간 Y분 Z초' 형식의 문자열로 변환합니다.
 */
export function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) return `${hours}시간 ${String(minutes).padStart(2, '0')}분`;
    if (minutes > 0) return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
    return `${seconds}초`;
}

/**
 * 2. 날짜 포맷팅 유틸리티 (from background.js & dataManager.js)
 * 타임스탬프를 'YYYY-MM-DD' 형식의 로컬 날짜 문자열로 변환합니다.
 */
export function getLocalDateStr(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 오늘 날짜 문자열 반환 (from dataManager.js)
 */
export function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * 3. 어제 날짜 문자열 반환 (from dataManager.js)
 */
export function getYesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateStr(d.getTime());
}

/**
 * 4. 핵심: 마찰 필터 적용 시간/요일 조건 확인 (Enhanced checkTimeCondition)
 * (scheduleActive, startMin, endMin) 외에 days 배열 (0=일 ~ 6=토)을 체크합니다.
 * @param {object} schedule - { scheduleActive: boolean, startMin: number, endMin: number, days: number[] }
 * @returns {boolean} 필터를 적용해야 할 조건이면 true 반환
 */
export function isFrictionTime(schedule) {
    // 스케줄 기능이 비활성화되었거나 설정이 불완전하면 항상 true 반환
    if (!schedule || !schedule.scheduleActive) return true; 

    const now = new Date();
    const currentDay = now.getDay(); // 0 (일) ~ 6 (토)

    // A. 요일 조건 확인 (days 배열이 없거나 비어 있으면 요일 조건 무시)
    if (Array.isArray(schedule.days) && schedule.days.length > 0) {
        if (!schedule.days.includes(currentDay)) {
            return false; // 오늘이 지정된 스케줄 요일이 아니면 false
        }
    }

    // B. 시간 조건 확인 (기존 로직)
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const { startMin, endMin } = schedule;

    // 야간 스케줄을 포함하는 경우 (예: 23:00 ~ 07:00)
    if (startMin > endMin) { 
        // 현재 시간이 시작 시간보다 늦거나 종료 시간보다 이르면 true
        return currentMinutes >= startMin || currentMinutes < endMin; 
    } else {
        // 일반 스케줄 (예: 09:00 ~ 17:00)
        return currentMinutes >= startMin && currentMinutes < endMin;
    }
}

/**
 * URL에서 www.를 제외한 호스트네임(도메인)을 추출합니다.
 */
export function getHostname(url) {
  try {
    const u = new URL(url);
    // URL 파싱 오류 방지를 위해 유효성 검사 추가 (만약 contentScript.js에서 이미 했다면 생략 가능)
    return u.hostname ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

