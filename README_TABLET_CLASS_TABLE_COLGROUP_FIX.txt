PE-ON 학급 전체 생성 태블릿 표 폭 수정

수정 내용
1. StudentRecords.jsx의 학급 전체 생성 표에 colgroup을 추가했습니다.
2. CSS만으로 안 먹던 열 폭을 JSX 구조에서 직접 잡았습니다.
3. 태블릿 기준:
   - 수행 근거: 105px로 축소
   - 성장 과정: 145px로 축소
   - 생성된 세특: 610px로 확대
4. 기존 모바일 500byte 옆 작은 버튼은 유지했습니다.

적용 방법
1. 압축을 풉니다.
2. 기존 V9-개인전용 폴더에 덮어씁니다.
3. npm run build
4. firebase deploy --only hosting
