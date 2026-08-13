# Security policy

Security fixes are provided for the latest development branch and most recent
published client release.

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, terminal transcript, or screenshot. Use GitHub's private **Report a
vulnerability** form in the repository Security tab. Include the affected
client and version, reproduction steps, impact, platform, and required attacker
access.

Treat pair codes, endpoint passwords and private keys, access and refresh
tokens, local socket access, signing keys, remote file paths, and terminal/file
contents as sensitive. Revoke and rotate exposed credentials before sharing a
redacted report.

The desktop client reads local TGent metadata only from same-user locations and
prefers a permission-restricted local socket. Remote endpoints should use TLS
and authentication.
