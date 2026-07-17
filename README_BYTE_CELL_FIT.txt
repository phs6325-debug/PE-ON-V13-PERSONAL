PE-ON 학급 전체 생성 byte 셀 보정

수정 내용
1. byte 컬럼 폭을 120px로 확대했습니다.
2. 500 선택박스가 셀 밖으로 튀어나오지 않도록 width를 100%로 조정했습니다.
3. 0byte 표시를 가운데 정렬했습니다.
4. 태블릿 표 전체 폭도 byte 컬럼에 맞게 재조정했습니다.
5. 모바일의 500byte 옆 작은 버튼 구조는 유지했습니다.

적용 방법
npm run build
firebase deploy --only hosting
