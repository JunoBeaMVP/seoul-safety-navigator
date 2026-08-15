# 서울 안전 길잡이

> **실시간 기상 위험을 읽고, 상황에 맞는 서울시 공식 대피시설까지 안내하는 위치 기반 웹앱입니다.**

[서비스 열기](https://seoulnav-tktw6gc7.manus.space) · [보안 정책](SECURITY.md) · [기여 가이드](CONTRIBUTING.md) · [운영 연동 메모](docs/integration-notes.md)

## 목적과 안전 원칙

서울 안전 길잡이는 브라우저의 현재 위치를 기준으로 기상청 실황·특보와 서울시 대피시설 데이터를 조합하여, 폭염·호우·민방위 상황에 적합한 시설을 안내합니다. 이는 **참고용 안내 도구**이며, 실제 대피 결정과 이동 경로는 재난문자, 119·112, 현장 통제와 시설 운영 상태를 우선해야 합니다.

| 기능 영역 | 구현 내용 | 주요 출처 |
| --- | --- | --- |
| 위치 | 브라우저 Geolocation API로 위도·경도 획득, 권한 거부 시 서울시청 기준 안내 | 브라우저 위치 API |
| 위험 감지 | 기상청 특보와 초단기실황의 기온·강수량·습도 표시 | 공공데이터포털 기상청 API |
| 대피소 | 폭염·호우·민방위 유형별로 서울시 공식 시설을 검색하고 거리순 정렬 | `OA-21065`, `OA-21181`, `LOCALDATA_114602` |
| 지도·경로 | Leaflet·OpenStreetMap 지도, OpenRouteService 도보 경로 | OpenStreetMap, OpenRouteService |
| 알림 | 특보 화면 배너와 사용자 승인 기반 브라우저 알림 | Notification API |

OpenStreetMap 데이터와 타일의 출처는 지도 화면에 표기하며, 해당 사용 정책을 준수해야 합니다.[^osm] GitHub는 `README.md`, `CONTRIBUTING.md`, `SECURITY.md` 등 커뮤니티 헬스 파일을 공개 프로젝트의 권장 운영 문서로 안내합니다.[^github-health]

## 기술 구성

| 계층 | 구성 |
| --- | --- |
| 프런트엔드 | React, TypeScript, Tailwind CSS, Leaflet, React Leaflet |
| 서버 | Express, tRPC, Zod 입력 검증 |
| 데이터 | MySQL/TiDB, Drizzle ORM, 서버 메모리 캐시 |
| 외부 연동 | 기상청, 서울 열린데이터광장, OpenRouteService |
| 배포 | Manus 관리형 웹 런타임 |

## 빠른 시작

```bash
pnpm install
pnpm dev
```

기본 정적 검증과 테스트는 다음과 같이 실행합니다.

```bash
pnpm check
pnpm test
```

## 환경변수와 비밀값

**실제 API 키, 토큰, 인증서, 데이터베이스 연결 문자열을 저장소에 커밋하지 마세요.** 이 프로젝트의 외부 API 키는 배포 환경의 서버 비밀값으로만 관리합니다. 클라이언트 코드에는 `VITE_` 접두사가 붙은 공개 설정만 둘 수 있으며, 아래 값은 절대 클라이언트 번들에 넣으면 안 됩니다.

```text
# 배포 플랫폼의 서버 비밀값에 등록할 변수명입니다.
KMA_SERVICE_KEY=
SEOUL_OPEN_API_KEY=
OPENROUTE_SERVICE_KEY=
```

GitHub Actions가 필요한 경우에는 저장소 또는 환경 수준의 Secrets에 값을 등록하고, 워크플로 로그에 값을 출력하지 마세요.[^github-secrets] 추가 운영 규칙은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 데이터 출처와 운영

세부 API 경로, 좌표계 호환 처리, 특보 우선순위, 배포 후 예약 갱신 절차는 [운영 연동 메모](docs/integration-notes.md)에 기록되어 있습니다. 데이터 제공처의 서비스 약관, 호출 한도, 갱신 주기는 운영 시점에 재확인해야 합니다.

## 기여와 지원

개선 제안과 버그 신고 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를, 보안 이슈 신고 절차는 [SECURITY.md](SECURITY.md)를 따릅니다. 이용자 안전과 직접 관련된 변경은 테스트·현장 검토·데이터 출처 재확인을 거친 뒤 병합해야 합니다.

[^osm]: [OpenStreetMap Foundation, Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
[^github-health]: [GitHub Docs, Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
[^github-secrets]: [GitHub Docs, Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
