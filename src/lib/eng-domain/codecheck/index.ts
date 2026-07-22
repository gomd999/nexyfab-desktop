/**
 * eng-domain/codecheck — deterministic 코드체크 / 감리 보조.
 * Each rule cites a real public 법령/기준 clause; output is PASS/FAIL/NA with actual-vs-required.
 * NON-STATUTORY: 면허 감리/기술사를 대체하지 않음 (see CODECHECK_DISCLAIMER).
 */
export * from './rules';
export * from './runCodeCheck';
