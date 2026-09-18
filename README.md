# 여행 통역 / Travel Translator

여행·출입국 등에서 **버튼을 눌러 녹음하고, 중지한 뒤에만 한 번 번역**하는 간단한 웹 MVP입니다.
녹음 중에는 들린 말만 보이고, 중지하면 그 전체 문장을 큰 글씨로 번역합니다. **오디오는 디스크에 저장하지 않습니다.**

A simple mobile-first web MVP: tap to record, tap to stop, then translate that take once. **Never saves audio to disk.**

## 실행 / Run

```bash
npm install
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm run preview
```

- **권장 브라우저: Chrome** (Web Speech API)
- HTTPS 또는 `localhost`에서 마이크 사용
- 한국어 UI / Korean UI labels

## 기능 요약

1. 첫 화면은 통역기 (동의 게이트 없음). 법적 안내는 하단 「개인정보 / 안내」
2. 듣는 언어 기본 영어, 번역 언어 기본 한국어. 녹음 중에는 언어 변경 불가
3. 원형 버튼 하나. **녹음**을 누르면 마이크가 켜지고, **중지**를 누르면 꺼집니다. 녹음 중에는 들린 말만 보이고 `translate()`를 호출하지 않습니다. 쉼 타이머·자동 문장 확정은 없습니다. 중지하면 `abort()`로 마이크를 끊고(그 세대의 늦은 결과는 다시 시작하지 않음), 이번 녹음 전체 문장을 정확히 한 번 번역합니다. 결과가 오면 큰 글씨는 그 번역뿐입니다. 다시 녹음하면 받아쓰기를 새로 시작하고, 직전 번역은 최근 2줄(번역문만, 한 줄)로 내려갑니다. 들린 말이 없으면 번역하지 않고 「들린 말이 없어요.」를 보여 줍니다. 번역이 실패하면 오류와 들린 문장을 남깁니다. 탭이 숨겨지면 중지 — 창 blur로는 중지하지 않음
4. Web Speech API 연속 인식 (녹음이 끝나기 전에는 엔진이 스스로 끊겨도 같은 테이크로 재시작)
5. 무료 클라이언트 번역 (`src/lib/translate.ts` — MyMemory → LibreTranslate 폴백). API 키 없음
6. 일정한 크기의 번역. 이전 번역은 목표 언어만 짧게(지우기 가능)
7. 개인정보·법적 안내 페이지
8. 광고·계정·오디오/대화 텔레메트리 없음

## 환경 변수 (선택)

`.env.example` 참고. 유료/자체 번역 API:

- `VITE_TRANSLATE_API_URL` — LibreTranslate 호환 POST
- `VITE_TRANSLATE_API_KEY` — 선택적 Bearer 키

## 개인정보 / Privacy

- 오디오 미저장
- 번역은 **텍스트만** 공개 번역 API로 전송 (기본 MyMemory)
- 브라우저 음성 인식은 Chrome 정책에 따라 클라우드 처리될 수 있음
- 녹음·동의 관련 **현지법 준수 책임은 사용자**에게 있음 (법률 자문 아님)

## 기술 스택

Vite + React + TypeScript + plain CSS

## 주의 / Caveats

- Safari/Firefox는 SpeechRecognition 지원이 제한적일 수 있음. iOS의 Chrome도 WebKit이라 음성 인식이 없거나 불안정함
- 무료 번역 API는 지연과 **요청 한도**가 있어, 중지 뒤 번역이 조금 늦게 뜨거나 오류가 날 수 있음. 실패하면 들린 문장을 남기고 건너뛰지 않습니다
- 인식·번역 품질은 환경·방음·억양에 따라 달라짐
- 말의 쉼은 녹음을 끝내지 않습니다. 사용자가 중지할 때만 이번 테이크 전체를 한 번 번역합니다
- 중지는 `abort()`로 끄고, 세대를 올려 그 이후의 인식 결과는 그리지 않으며 마이크를 다시 켜지 않습니다. Chrome이 시작 중 `stop()`을 무시하면 `onstart`에서 다시 abort 합니다
