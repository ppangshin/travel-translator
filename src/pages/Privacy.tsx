interface PrivacyProps {
  onBack: () => void
}

export function Privacy({ onBack }: PrivacyProps) {
  return (
    <div className="page privacy-page">
      <header className="page-header">
        <button type="button" className="back" onClick={onBack}>
          ← 돌아가기
        </button>
        <h1>개인정보 · 법적 안내</h1>
      </header>

      <article className="prose">
        <h2>무엇을 하나요?</h2>
        <p>
          여행 통역은 브라우저의 음성 인식(Web Speech API)으로 마이크 입력을 글자로 바꾼 뒤,
          공개 번역 API로 텍스트만 번역해 화면에 크게 보여 줍니다.
        </p>

        <h2>저장하지 않는 것</h2>
        <ul>
          <li>오디오·음성 파일을 디스크에 저장하지 않습니다.</li>
          <li>계정·로그인·광고·사용량 추적(텔레메트리)이 없습니다.</li>
          <li>번역 기록은 이 기기 브라우저 메모리에만 잠시 두고, 「지우기」로 삭제할 수 있습니다.</li>
        </ul>

        <h2>브라우저·외부 서비스</h2>
        <ul>
          <li>
            <strong>음성 인식</strong>: Chrome 등에서 Web Speech API를 사용합니다. 인식 처리는
            브라우저/OS 정책에 따릅니다(클라우드 인식일 수 있음).
          </li>
          <li>
            <strong>번역</strong>: 기본적으로 MyMemory 등 무료 공개 API에 <em>텍스트만</em>{' '}
            보냅니다. 향후 유료 API는 환경 변수로 연결할 수 있습니다.
          </li>
        </ul>

        <h2>동의·현지법</h2>
        <p>
          일부 지역에서는 대화 상대의 동의 없이 녹음하거나 통역 도구를 쓰는 것이 제한될 수
          있습니다. 출입국·경찰 등 공식 상황에서는 특히 주의하세요. 관련 법 준수 책임은
          사용자에게 있습니다. 본 문구는 법률 자문이 아닙니다.
        </p>

        <h2>English summary</h2>
        <p>
          No audio is saved to disk. No accounts, ads, or telemetry of audio/transcripts. Speech
          recognition uses the browser Web Speech API; translation sends text only to a free public
          API (or a future env-configured API). You are responsible for local recording and consent
          laws. This is not legal advice.
        </p>
      </article>
    </div>
  )
}
