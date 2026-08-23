function section(markdown, name) {
  const marker = `## ${name}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return null;
  const contentStart = start + marker.length;
  const next = markdown.indexOf('\n## ', contentStart);
  return markdown.slice(contentStart, next < 0 ? markdown.length : next).trim();
}

function metadata(markdown, label) {
  const prefix = `- ${label}: `;
  const line = markdown.split(/\r?\n/).find(candidate => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length) ?? '';
  return value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : null;
}

export function evaluateHandoffDocument(markdown, scope, registry, resolveOwnership) {
  const issues = [];
  const branch = metadata(markdown, 'Branch');
  const head = metadata(markdown, 'Head');
  const integrationTarget = metadata(markdown, 'Integration target');
  if (branch !== scope.branch) issues.push('handoff_branch_mismatch');
  if (!/^[a-f0-9]{40}$/.test(head ?? '')) issues.push('handoff_head_invalid');
  if (integrationTarget !== registry.integrationBranch) issues.push('handoff_integration_target_mismatch');
  const summary = section(markdown, 'Summary');
  if (!summary || summary.length < 20 || /\bTODO\b/i.test(summary)) issues.push('handoff_summary_incomplete');
  const changed = section(markdown, 'Changed paths');
  if (changed === null) issues.push('handoff_changed_paths_missing');
  const changedPaths = [...(changed ?? '').matchAll(/^- `([^`]+)`$/gm)].map(match => match[1].replaceAll('\\', '/'));
  if (new Set(changedPaths).size !== changedPaths.length) issues.push('handoff_changed_paths_duplicate');
  for (const file of changedPaths) {
    const ownership = resolveOwnership(file, registry);
    if (ownership.shared) issues.push(`handoff_shared_path_forbidden:${file}`);
    else if (ownership.owner !== scope.id) issues.push(`handoff_foreign_path_forbidden:${file}:${ownership.owner}`);
  }
  const verification = section(markdown, 'Verification');
  if (!verification) issues.push('handoff_verification_missing');
  for (const command of scope.checks) {
    const expected = `- [x] \`${command.toLowerCase()}\``;
    const checked = (verification ?? '').split(/\r?\n/).some(line => line.trim().toLowerCase().startsWith(expected));
    if (!checked) issues.push(`handoff_required_check_not_verified:${command}`);
  }
  const risks = section(markdown, 'Remaining work and risks');
  if (!risks || !risks.split(/\r?\n/).some(line => line.startsWith('- ')) || /\bTODO\b/i.test(risks)) issues.push('handoff_risks_incomplete');
  return { ok: issues.length === 0, issues, branch, head, integrationTarget, changedPaths };
}
