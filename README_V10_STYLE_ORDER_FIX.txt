PE-ON V10 교과세특 스타일 순서 수정

원인:
App.jsx가 StudentRecords 컴포넌트를 불러온 뒤 style.css를 다시 import하여,
StudentRecords.css보다 기존 전역 CSS가 나중에 적용되고 있었습니다.
그 결과 전용 레이아웃이 전역 규칙에 덮였습니다.

수정:
1. App.jsx의 중복 import "./styles/style.css" 제거
2. main.jsx의 기존 전역 CSS import는 유지
3. StudentRecords.jsx에서 StudentRecords.css를 직접 import

적용 후:
npm run build
firebase deploy --only hosting
