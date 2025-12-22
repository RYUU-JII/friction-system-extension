# Friction Extension (MV3)

사용 습관을 교정하는 크롬 확장 프로그램입니다. 콘텐츠에 "마찰(Friction)"을 적용해
즉각적 반응을 늦추고, 행동 기록/대시보드로 장기적인 습관 개선을 돕습니다.

## 주요 기능
- 시각/텍스트/입력/스크롤 마찰 적용
- 소셜 지표(좋아요/조회수 등) 숨김
- Anxiety Engine 기반 점수 산출 및 개입
- 대시보드 통계/설정 UI 제공

## 프로젝트 구조
```
src/
  manifest.json
  entries/                # 컨텍스트 진입점
    background/index.js
    content/index.js
    content/earlyApply.js
    content/loader.js
    content/earlyApplyLoader.js
    popup/index.js
    dashboard/index.js
  features/               # 도메인 로직
    friction/             # Managers (Visual/Text/Interaction/SocialMetrics 등)
    anxiety-engine/       # 행동 점수 로직
    dashboard/            # 대시보드 탭별 로직
  shared/                 # 공용 모듈
    storage/DataManager.js
    dom/ObserverHub.js
    config/index.js
    config/sites.js       # 사이트별 선택자 관리
    utils/
  styles/
    friction.css          # CSS 변수 기반 마찰 스타일
    popup.css
  pages/
    popup.html
    dashboard.html
  icons/
  samples/
```

## 빌드/로드 방법
1) 설치
```
npm i
```

2) 빌드
```
npm run build
```

3) 크롬에서 `dist/` 폴더를 "압축 해제된 확장 프로그램"으로 로드

## 핵심 설계 메모
- CSS는 `src/styles/friction.css`에만 존재하고, JS는 CSS 변수만 제어합니다.
- DOM 변경 감지는 `ObserverHub`를 통해 중앙화합니다.
- 사이트별 선택자는 `src/shared/config/sites.js`에서 관리합니다.

## 디버그 팁
- "Cannot use import statement outside a module" 오류가 나면 `dist/`를 다시 로드하세요.
- 자산/텍스트 로딩 오류가 나면 `dist/samples/` 경로 존재 여부를 확인하세요.
