V10 태블릿 학생별 작성 최종 보정

수정:
- 5번 AI 생성 결과 작성 셀 높이 110~118px로 축소
- 생성/저장/취소/삭제 버튼 4개 한 줄 강제 표시
- 버튼 높이 40px
- 카드와 상위 영역 overflow 제거
- 터치 태블릿과 큰 viewport 태블릿 모두 대응

적용:
npm run build
firebase deploy --only hosting
