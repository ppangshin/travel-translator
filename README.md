# 여행 통역 / Travel Translator

여행·출입국에서 **버튼을 눌러 듣고, 말이 한동안 끊기면 그 문장만 번역**하는 간단한 웹입니다.
녹음 중 아직 끝나지 않은 말은 원문만 조용히 보이고, 끝난 문장은 아래로 쌓입니다. 원문은 작게, 번역이 읽히는 글입니다. **오디오는 디스크에 저장하지 않습니다.**

A simple mobile travel translator: tap to listen. When a phrase stays still, that sentence is translated once and stacked under the previous one. **Never saves audio to disk.**

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
3. 원형 버튼 하나. **녹음**을 누르면 마이크가 켜지고, **중지**를 누르면 꺼집니다. 녹음 중에는 중간 단어마다 번역하지 않습니다. 아직 끝나지 않은 말은 아래쪽에 원문만 보입니다. 그 말이 약 1.1초 동안 그대로이면 한 줄로 쌓고 그 문장만 한 번 번역합니다. 마이크는 켜진 채 다음 말이 새 줄이 됩니다. 이전 문장을 다음 문장으로 바꾸지 않습니다. 각 줄은 작은 원문과 그 아래 번역입니다. 위가 먼저 들은 문장, 아래(버튼 쪽)가 최근입니다. 중지는 세대를 올리고 `halt()` → `abort()`로 마이크를 끊습니다. 그 세대의 늦은 결과는 다시 시작하지 않습니다. 중지할 때 남은 말이 있으면 그 문장도 번역합니다. 줄은 화면에 남고, **지우기**로 지웁니다. 번역이 실패하면 그 줄의 원문과 짧은 오류를 남기고 문장을 버리지 않습니다. 들린 말이 없으면 「들린 말이 없어요.」 탭이 숨겨지면 중지 — 창 blur로는 중지하지 않음
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
- 말의 쉼은 녹음을 끝내지 않습니다. 약 1.1초 동안 그 문장이 그대로이면 그 문장만 한 번 번역하고, 마이크는 계속 켜져 있습니다
- 중지는 `abort()`로 끄고, 세대를 올려 그 이후의 인식 결과는 그리지 않으며 마이크를 다시 켜지 않습니다. Chrome이 시작 중 `stop()`을 무시하면 `onstart`에서 다시 abort 합니다
