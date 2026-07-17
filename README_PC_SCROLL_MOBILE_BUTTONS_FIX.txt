PE-ON PC 가로스크롤 + 모바일 버튼 확대 수정

수정 내용
1. PC/태블릿 학급 전체 생성 표 가로스크롤 복구
2. 오른쪽 byte 영역이 잘리지 않도록 table min-width 복구
3. 모바일 학급 전체 생성 메인 생성/복사/삭제 버튼 더 크게 확대
   - 높이 68px
   - 글자 19px
4. 500byte 옆 작은 버튼은 작은 크기 유지

적용 방법
npm run build
firebase deploy --only hosting
