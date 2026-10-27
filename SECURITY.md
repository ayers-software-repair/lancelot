# Security Policy

## Reporting a vulnerability

Do not open a public issue. Email support@ayers.repair with the subject
`[Lancelot security] <short summary>`. Include the version, a minimal reproduction, your assessment
of the impact, and a suggested fix if you have one.

## In scope

- Anything that makes Lancelot write to, or delete from, the LanceDB database it reads.
- Anything that makes a tool argument reach the SQL filter, the file system or a shell unescaped.
- Anything that leaks the OpenAI API key, in logs, in tool replies or in the files Lancelot writes.
- Anything that writes to stdout other than MCP messages while the server runs.

## Out of scope

- Vulnerabilities in dependencies with no reachable path through Lancelot. Report those upstream.
- The contents of a database the operator points Lancelot at. Tool replies return what the
  database holds.

## Response

We acknowledge a report within 3 business days and give a triage result within 7. A confirmed
issue gets a fix or a dated mitigation plan.
