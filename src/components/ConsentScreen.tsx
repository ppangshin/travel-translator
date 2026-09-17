interface ConsentScreenProps {
  onAccept: () => void
}

export function ConsentScreen({ onAccept }: ConsentScreenProps) {
  return (
    <div className="consent">
      <div className="consent-card">
        <h1 className="consent-title">여행 통역</h1>
        <p className="consent-sub">실시간 음성 → 화면 번역</p>

        <ul className="consent-list">
          <li>
            <strong>마이크</strong>는 상대방 말을 듣고 실시간으로 글자로 바꾸기 위해서만
            사용합니다.
          </li>
          <li>
            이 앱은 <strong>실시간 번역 표시</strong>만 합니다. 오디오를 기기에 저장하지
            않습니다.
          </li>
          <li>
            일부 국가·상황에서는 <strong>상대방 동의</strong>나 녹음·통역 관련 법이 적용될 수
            있습니다. 특히 공무원·출입국 심사 등과 관련된 경우 현지 규칙을 스스로 확인하세요.
          </li>
          <li>
            사용자는 현지법·두 당사자 동의(two-party consent) 등 관련 규정을 준수할{' '}
            <strong>책임이 본인에게</strong> 있습니다.
          </li>
        </ul>

        <p className="consent-disclaimer">
          본 안내는 법률 자문이 아닙니다. (This is not legal advice.)
        </p>

        <button type="button" className="btn btn-primary btn-block" onClick={onAccept}>
          이해하고 시작하기
        </button>
      </div>
    </div>
  )
}
