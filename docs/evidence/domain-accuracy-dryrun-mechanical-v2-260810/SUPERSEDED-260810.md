# Superseded mechanical dry-run evidence

This directory preserved the first 24-axis run. It exposed a real `machine_line` safety-fence
coordinate defect: the STEP file contained non-finite coordinates and all 15 repeats failed
round-trip import. The source defect and a real STEP re-import regression were then fixed.

This remains diagnostic history, not certification evidence. The corrected run is generated in
`domain-accuracy-dryrun-mechanical-v3-260810`.
