PE-ON V13 PAPS 기준표/학생카드 동기화 수정

1. 업로드된 팝스 평가기준.xls의 중학교 남/여 전체 기준(1~3학년)을 코드에 반영했습니다.
2. 성별 + 학년 + 종목 + 기록 범위를 모두 확인하여 점수와 등급을 동시에 계산합니다.
3. PAPS 탭과 명렬표 학생카드는 동일한 peon_{학년도}_{학기}_paps_scores 데이터를 사용합니다.
4. 표시 예: 48회 (11점) · 3등급
5. Firebase 로그인 상태에서는 PAPS 공통 문서를 실시간 구독하므로 두 화면의 원본 데이터가 동일합니다.

배포 명령어
npm install
npm run build
firebase deploy --only hosting

또는 Windows에서 1_BUILD_AND_DEPLOY.cmd 실행
