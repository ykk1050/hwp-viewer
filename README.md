# 한글 뷰어

광고 없는 HWP · HWPX 문서 뷰어 (설치형 웹앱, PWA)

- 안드로이드 크롬에서 열고 **앱 설치(홈 화면에 추가)**
- 카카오톡·파일 앱에서 문서를 **공유 → 한글 뷰어**로 보내면 바로 열림
- 파일은 기기 안에서만 처리하고 외부로 보내지 않음
- 최근 문서 8개를 이 기기에만 보관

렌더링 엔진: [rhwp](https://github.com/edwardkim/rhwp) `@rhwp/core` 0.8.7 (MIT, `lib/RHWP-LICENSE`)

엔진 갱신: `npm install @rhwp/core@latest` 후 `rhwp.js`, `rhwp_bg.wasm`을 `lib/`로 복사하고 `sw.js`의 VERSION을 올린다.
