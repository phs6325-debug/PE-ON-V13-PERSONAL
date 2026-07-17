PE-ON V11 모바일 점수확인 수정본

수정 내용
- 모바일 점수확인 표 가로 스크롤 지원
- 번호와 이름 열을 왼쪽에 고정
- 평가활동 점수 및 총점은 좌우로 밀어 확인
- 모바일에 '← 좌우로 밀어 점수 확인 →' 안내 추가
- 중복된 내부 PE-ON-V11 프로젝트 폴더 제거
- 다른 기능은 변경하지 않음

빌드 확인
- CSS: index-WJR5GaYA.css
- JS: index-DhnQ6cau.js

실행
npm install
npm run build
firebase deploy --only hosting
