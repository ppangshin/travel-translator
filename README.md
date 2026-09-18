# 여행 통역 / Travel Translator

여행·출입국 등에서 **상대 말을 듣고 큰 글씨로 실시간 번역**하는 간단한 웹 MVP입니다.
마이크를 켠 채 듣고, 번역만 화면에 표시합니다. **오디오는 디스크에 저장하지 않습니다.**

A simple mobile-first web MVP for travel voice translation (e.g. immigration). Keep the mic on, show live translation in large text. **Never saves audio to disk.**

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
2. 듣는 언어 기본 영어, 번역 언어 기본 한국어. 듣기 중에는 언어 변경 불가
3. 화면을 한 번 누르면 마이크가 켜집니다. 말이 약 0.6초 멈추거나 원형을 누르면 그 구간만 번역되고, 큰 글씨는 그 번역만 보여 줍니다(대화를 이어 붙이지 않음). 직전 번역은 최대 2줄. 원형이 듣기/음소거입니다. 탭이 숨겨지면 중지 — 창 blur로는 중지하지 않음
4. Web Speech API 연속 인식
5. 무료 클라이언트 번역 (`src/lib/translate.ts` — MyMemory → LibreTranslate 폴백)
6. 일정한 크기의 번역, 들린 말은 작은 줄, 이전 번역은 목표 언어만 짧게(지우기 가능)
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
- 무료 번역 API는 지연과 **요청 한도**가 있어, 말이 멈춘 뒤 번역이 조금 늦게 뜨거나 짧은 오류가 날 수 있음
- 인식·번역 품질은 환경·방음·억양에 따라 달라짐
- 한 구간은 약 0.6초 쉼 또는 음소거입니다. 더 짧은 쉼은 한 마디로 남고, 이미 넘긴 구간의 인식 수정은 화면을 다시 채우지 않습니다
- 음소거는 `abort()`로 끄고, 그 세대 이후의 인식 결과는 그리지 않습니다. Chrome이 시작 중 `stop()`을 무시하면 `onstart`에서 다시 abort 합니다
