V10 태블릿 학생별 작성 하단 버튼 수정

수정 내용
- 태블릿 학생별 작성 AI 생성 결과 카드 하단 버튼 4개 한 줄 표시
- 생성 / 저장 / 취소 / 삭제
- 카드 높이 자동 확장
- overflow/잘림 제거
- PC와 모바일 스타일은 그대로 유지

적용
npm run build
firebase deploy --only hosting
