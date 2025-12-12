# ⚡ Friction System: 리캡 & 포커스 웹 확장 프로그램

> 웹 사용 습관을 추적하고, 방해되는 웹사이트에 '마찰(Friction)' 필터를 적용하여 사용자가 집중하도록 돕는 크롬 확장 프로그램입니다.

## 🌟 개요 (Description)

이 프로젝트는 웹 서핑 중 무의미한 시간 낭비를 줄이고 생산성을 높이기 위해 설계되었습니다. 단순한 차단 대신, 인지적 마찰을 유발하는 필터를 적용하여 사용자가 무의식적인 접속 대신 **의식적인 선택**을 하도록 유도합니다.

## 💡 주요 기능 (Features)

* **📊 사용량 리캡:** 포그라운드(Active) 및 백그라운드 사용 시간, 방문 횟수 등 상세한 일간/주간 통계를 제공합니다.
* **🚫 차단 목록 및 스케줄:** 방해되는 도메인을 등록하고, 특정 시간대에만 필터가 작동하도록 스케줄을 설정할 수 있습니다.
* **⚙️ 커스텀 마찰 필터:** 다음과 같은 6가지 필터의 강도를 개별적으로 조절하여 자신에게 맞는 마찰 환경을 구축합니다.
    * **시각적 마찰:** 블러(Blur), 채도 감소(Desaturation)
    * **텍스트 마찰:** 자간 늘림(Letter Spacing)
    * **상호작용 마찰:** 클릭 지연(Click Delay), 스크롤 마찰(Scroll Friction), 로딩 지연(Delay)

## 🛠️ 설치 및 실행 (Installation & Setup)

이 프로젝트는 Chrome 웹 스토어에 등록되어 있지 않으므로, 개발자 모드를 통해 설치해야 합니다.

1.  **프로젝트 복제:**
    ```bash
    git clone [https://github.com/RYUU-JII/friction-system-extension](https://github.com/RYUU-JII/friction-system-extension)
    ```
2.  **크롬 확장 프로그램 관리자 접속:**
    * 크롬 브라우저에서 `chrome://extensions` 주소로 접속합니다.
3.  **개발자 모드 활성화:**
    * 페이지 우측 상단의 **'개발자 모드'** 토글을 킵니다.
4.  **확장 프로그램 로드:**
    * **'압축 해제된 확장 프로그램을 로드합니다'** 버튼을 클릭합니다.
    * 복제한 `friction-system-extension` 프로젝트 폴더를 선택합니다.

설치가 완료되면, 확장 프로그램 아이콘을 클릭하여 대시보드에 접근할 수 있습니다.

## 🤝 기여 (Contributing)

버그 보고, 기능 제안, 코드 개선 등 모든 형태의 기여를 환영합니다.

1.  저장소를 Fork 합니다.
2.  새로운 브랜치에서 작업합니다 (`git checkout -b feature/your-feature`).
3.  커밋하고 푸시합니다 (`git push origin feature/your-feature`).
4.  Pull Request를 생성합니다.

## 📝 라이선스 (License)