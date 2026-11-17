# 3D GLB Web Viewer

블렌더(Blender)에서 제작 및 베이킹한 `.glb` (glTF 2.0 Binary) 에셋을 웹 브라우저에서 인터랙티브하게 확인할 수 있는 순수 HTML/JavaScript + Three.js 기반 3D 뷰어입니다.

## 주요 기능

- **Three.js (v0.187.0) 기반 PBR 렌더링**: `GLTFLoader` + `DRACOLoader`(Draco 압축 지원), `RoomEnvironment` IBL(또는 커스텀 `.hdr` HDRI), 3점 조명(Key/Fill/Rim), `NeutralToneMapping` 적용
- **Bounding Box 자동 센터링**: 모델 크기나 피벗 위치와 무관하게 로드 즉시 원점 정렬 및 화면 맞춤 카메라 거리 보정
- **두 가지 카메라 모드**:
  - **오르빗 모드**: 마우스 드래그/터치 360도 회전, 줌, 패닝
  - **1인칭 관전자 모드 (`V` 키)**: `WASD` 자유 이동, `E/Space` 상승, `Q/C/Ctrl` 하강, `Shift` 가속, 마우스 휠 이동 속도 조절, FPS 마우스 시점(Pointer Lock + 드래그 폴백)
- **실시간 커스터마이징 UI**: 시야각(FOV `40°~100°`) 슬라이더, 배경색/투명 배경 전환, 자동 회전, 내장 애니메이션 재생/일시정지, 로컬 `.glb` 드래그 앤 드롭 미리보기

## 로컬 실행 방법

브라우저 보안 정책(CORS)상 `file://` 경로에서는 ES Module 및 `.glb` 로딩이 차단되므로 로컬 웹 서버로 실행해야 합니다.

```bash
# Python 내장 서버
python -m http.server 8000

# 또는 Node.js
npx serve . -l 8000
```

실행 후 `http://localhost:8000`으로 접속하세요.

## 모델 경로 설정

- 기본 경로: `models/model.glb`
- `viewer.js` 상단 `VIEWER_CONFIG.modelUrl` 수정 또는 URL 쿼리(`?model=./models/asset.glb`)로 지정 가능
- 실행 중인 화면에 `.glb` 파일을 드래그 앤 드롭해 즉시 테스트 가능
