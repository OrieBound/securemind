#!/bin/sh
set -e

# Load Cognito ids written by the init container (Floci pool is created at first boot).
if [ -f /bootstrap/runtime.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /bootstrap/runtime.env
  set +a
fi

exec "$@"
