import { buildInfo } from './buildInfo'

function shortRevision(value: string) {
  return value === 'local' ? value : value.slice(0, 7)
}

export function BuildRevision() {
  const requestedRevision = new URLSearchParams(window.location.search).get('revision')
  const hasMismatch = Boolean(
    requestedRevision
      && buildInfo.commit !== 'local'
      && requestedRevision !== buildInfo.commit,
  )
  const metadataUrl = `${import.meta.env.BASE_URL}build-info.json?revision=${encodeURIComponent(buildInfo.commit)}`
  const statusLabel = hasMismatch
    ? `版本不匹配：请求 ${shortRevision(requestedRevision!)}，当前 ${buildInfo.shortCommit}`
    : buildInfo.status === 'verified'
      ? '已验证发布'
      : '本地构建'

  return (
    <a
      className={`build-revision build-revision--${hasMismatch ? 'mismatch' : buildInfo.status}`}
      data-build-revision={buildInfo.commit}
      data-build-status={hasMismatch ? 'mismatch' : buildInfo.status}
      href={metadataUrl}
      target="_blank"
      rel="noreferrer"
      title={`构建时间 ${buildInfo.builtAt}${buildInfo.runUrl ? ` · ${buildInfo.runUrl}` : ''}`}
    >
      <span className="build-revision__dot" aria-hidden="true" />
      <span>{statusLabel}</span>
      {!hasMismatch && <code>{buildInfo.branch}@{buildInfo.shortCommit}</code>}
    </a>
  )
}
