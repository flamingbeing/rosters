#!/bin/bash
# Firestore rules tests for nuh-roster/, ntf-roster/ and nuh-junior-monthly/firestore.rules in the local emulator, with
# fake accounts and demo projects: nothing reaches the live Firebase projects and no sign-in is needed.
# Needs Java. The test tools install on first use (below), once per machine, into ~/.cache/anawj-rules.
set -u
cd "$(dirname "$0")/.."
TOOLS="${RULES_TOOLS:-$HOME/.cache/anawj-rules}"
if [ ! -x "$TOOLS/node_modules/.bin/firebase" ]; then
  echo "Installing the emulator test tools into $TOOLS (once)…"
  npm install --silent --prefix "$TOOLS" firebase-tools@13 @firebase/rules-unit-testing firebase || exit 1
fi
# the test files import the packages by name: link them in for the run only
made_link=0
if [ ! -e node_modules ]; then ln -s "$TOOLS/node_modules" node_modules; made_link=1; fi
rc=0
run() {   # app folder, demo project
  local cfg; cfg="$(mktemp -d)/firebase.json"
  echo "{ \"firestore\": { \"rules\": \"$1/firestore.rules\" }, \"emulators\": { \"firestore\": { \"port\": 8085, \"host\": \"127.0.0.1\" }, \"ui\": { \"enabled\": false } } }" > "$cfg"
  "$TOOLS/node_modules/.bin/firebase" emulators:exec --config "$cfg" --only firestore --project "$2" \
    "cd $1 && node test/rules.emulator.mjs" 2>&1 | grep -E 'checks passed|checks failed|^FAIL|^Error:'
  [ "${PIPESTATUS[0]}" = 0 ] || rc=1
}
run nuh-roster demo-roster
run ntf-roster demo-ntf-roster
run nuh-junior-monthly demo-nuh-junior-monthly
[ $made_link = 1 ] && rm node_modules
exit $rc
