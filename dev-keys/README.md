# Development keys only

This RSA key pair exists so the demo runs with no setup. The private key is
public on GitHub, so **anything signed with it is untrustworthy**.

For a real product: keep the private key in a secrets manager or KMS on the
server (`LICENSE_PRIVATE_KEY` / `LICENSE_PUBLIC_KEY` env vars override these
files), and compile only the public key into the app.

Regenerate:

    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
    openssl rsa -in private.pem -pubout -out public.pem
