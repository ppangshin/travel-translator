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

1. 최초 실행 동의 화면 (마이크 목적, 실시간 번역만, 현지법·동의 책임)
2. 듣는 언어 기본 영어, 번역 언어 기본 한국어
3. 듣기 시작/중지, 명확한 청취 표시, 탭 숨김/blur 시 자동 중지
4. Web Speech API 연속 인식
5. 무료 클라이언트 번역 (`src/lib/translate.ts` — MyMemory → LibreTranslate 폴백)
6. 큰 번역 표시 + 짧은 텍스트 기록(지우기 가능)
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

- Safari/Firefox는 SpeechRecognition 지원이 제한적일 수 있음
- 무료 번역 API는 **요청 한도(rate limit)** 가 있어 오류 메시지가 표시될 수 있음
- 인식·번역 품질은 환경·방음·억양에 따라 달라짐
