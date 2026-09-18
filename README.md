# 여행 통역 / Travel Translator

여행·출입국에서 **버튼을 눌러 듣고, 중지하면 그 녹음 전체를 한 번 번역**하는 간단한 웹입니다.
녹음 중에는 들은 언어만 실시간으로 보이고, 번역은 녹음이 멈춘 뒤에만 합니다. 결과는 테두리 상자 안에 원문 위, 번역 아래입니다. 이전 녹음은 **히스토리**를 눌러야 보입니다. **오디오는 디스크에 저장하지 않습니다.**

A simple mobile travel translator: tap to listen. The heard language stays on screen the whole time the mic is on. Translation runs once, for the whole take, when you stop. **Never saves audio to disk.**

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
3. 원형 버튼 하나. **녹음**을 누르면 마이크가 켜지고, **중지**를 누르면 꺼집니다. 녹음 중에는 번역하지 않습니다. 테두리 상자 안에 들은 말이 끝까지 이어져 보입니다. 중지는 세대를 올리고 `halt()` → `abort()`로 마이크를 끊습니다. 그 세대는 마이크를 다시 켜지 않습니다. 중지하면 그 테이크 전체를 한 번 번역하고, 상자 위에는 원문, 아래에는 번역을 둡니다. 이전 테이크는 **히스토리**를 열어야 보입니다. 다시 누르면 닫힙니다. 지금 테이크는 본 상자에 남습니다. **지우기**로 지웁니다. 번역이 실패해도 원문은 남기고 짧은 오류만 붙입니다. 들린 말이 없으면 「들린 말이 없어요.」 탭이 숨겨지면 중지 — 창 blur로는 중지하지 않음
4. Web Speech API 연속 인식 (녹음이 끝나기 전에는 엔진이 스스로 끊겨도 같은 테이크로 재시작)
5. 무료 클라이언트 번역 (`src/lib/translate.ts` — MyMemory → LibreTranslate 폴백). API 키 없음
6. 번역이 길어지면 글만 스크롤하고, 녹음 버튼은 아래에 남깁니다
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
- 무료 번역 API는 지연과 **요청 한도**가 있어, 문장 번역이 조금 늦게 뜨거나 오류가 날 수 있음. 실패하면 원문을 남기고 건너뛰지 않습니다
- 인식·번역 품질은 환경·방음·억양에 따라 달라짐
- 말의 쉼은 녹음을 끝내지 않습니다. 번역은 중지를 누를 때 한 번만 합니다
- 중지는 `abort()`로 끄고, 세대를 올려 마이크를 다시 켜지 않습니다. Chrome이 시작 중 `stop()`을 무시하면 `onstart`에서 다시 abort 합니다. 인식 목록이 짧아져도 이미 들은 말은 지우지 않습니다
