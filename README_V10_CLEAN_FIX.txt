PE-ON V10 정리본

수정 내용
1. style.css 깨진 꼬리 제거
2. CSS 문법 오류 제거
   - border:1.50
   - height:56px;px
   - 닫히지 않은 중괄호
3. StudentRecords CSS import 정리
4. SharedFileBox 미리보기 버튼에 type="button" 추가
   - 폼 제출/새로고침으로 미리보기가 사라지는 문제 방지
5. 미리보기 로딩/오류 상태 추가
6. 기존 데이터 및 기능 로직 유지

적용:
npm run build
firebase deploy --only hosting

브라우저:
Ctrl + Shift + R
