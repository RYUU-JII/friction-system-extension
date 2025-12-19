// 지표별 가중치 설정 (실험을 통해 조정 가능)
const WEIGHTS = {
    // 1. 탐색적 지표 (가장 강력한 신호)
    tabSwitches: 8,      // 1분 내 탭 전환 1회당 8점 (10회면 80점 - 위험)
    dwellTime: 12,       // 10초 미만 이탈(체류시간 부족) 1회당 12점
    backHistory: 10,     // 뒤로가기 연타 1회당 10점
    domLoops: 15,        // 같은 사이트 무한 루핑 1회당 15점

    // 2. 물리적 지표 (보조 신호)
    scrollSpikes: 5,     // 비정상적 고속 스크롤 1회당 5점
    backspaces: 2,       // 짧은 시간 내 백스페이스 연타 1회당 2점
    clicks: 1,           // 일반 클릭 1회당 1점 (기본 노이즈)
    dragCount: 3,        // 의미 없는 드래그 반복 1회당 3점

    // 3. 시스템/미디어 지표
    tabBursts: 20,       // 1초 내 새 탭 여러 개 생성 1회당 20점
    videoSkips: 6,       // 영상 5초 건너뛰기 연타 1회당 6점
    mediaDensity: 4      // 1분 내 여러 미디어 노출 밀도 1회당 4점
};

/**
 * 실시간 불안 지수 계산 (0 ~ 100점 사이로 정규화)
 */
export function calculateAnxietyScore(metrics) {
    let rawScore = 0;

    // 각 지표에 가중치 곱해서 합산
    for (const [key, value] of Object.entries(metrics)) {
        if (WEIGHTS[key]) {
            rawScore += (value * WEIGHTS[key]);
        }
    }

    // [정규화 로직] 
    // 대략 100~120점 정도를 '극도의 불안(100점)' 상태로 매핑
    // 너무 민감하면 분모(120)를 키우고, 둔감하면 줄이세요.
    const maxReference = 120; 
    let finalScore = Math.min(100, Math.round((rawScore / maxReference) * 100));

    return finalScore;
}

/**
 * 점수에 따른 개입 단계 결정
 */
export function getInterventionLevel(score) {
    if (score >= 80) return 'CRITICAL'; // 즉각적인 개입 (별자리 게임 등)
    if (score >= 50) return 'WARNING';  // 마찰 강화 (안개 필터 등)
    if (score >= 30) return 'NOTICE';   // 가벼운 시각적 넛지
    return 'CALM';                      // 평온
}