PE-ON 학급 전체 생성 버튼 최종 복구

수정 내용
1. StudentRecords.jsx에서 학급 전체 생성 상단 생성/복사/삭제 버튼에 전용 class를 부여했습니다.
2. 모바일에서 이 버튼 3개를 큰 버튼으로 강제 복구했습니다.
   - 높이 58px
   - 글자 16px
   - 3개 균등 배치
3. 500byte 옆 작은 버튼은 별도 class라서 작은 크기 유지합니다.

적용 방법
npm run build
firebase deploy --only hosting
