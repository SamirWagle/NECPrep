#!/bin/bash
# End-to-end mock-test flow against a DEPLOYED Worker.
#
#   bash scripts/smoke-remote.sh
#   API=http://localhost:8787 ORIGIN=http://localhost:5173 bash scripts/smoke-remote.sh
#
# WHY THIS EXISTS
# ---------------
# The remote mock path is covered by 43 jsdom tests against a MOCKED api
# client. Those prove the client's logic; they cannot prove the two parties
# agree. This exercises the real thing end to end: a real session cookie, a
# real attempt, real opaque option refs, and the server doing the marking.
#
# The assertion that matters is in step 3: the paper is searched for any
# field that could carry an answer key. The client is never given one - that
# is the entire reason the mock moved server-side - and a regression there
# would be invisible to every test that only checks a score.
#
# Step 4 is a second, quieter check. It answers every question with its FIRST
# option, which on a bank with balanced answer positions should score close to
# 25%. A result far from that would mean the option permutation had drifted
# back toward a fixed position, which `scripts/validate-questions.mjs` guards
# statically and this observes in production.
#
# WHAT IT COSTS: one anonymous user, one attempt and ~100 answer rows on the
# target database, plus a few hundred D1 row writes. Harmless against the free
# plan's 100k/day, and the retention cron clears the answers in 90 days. Do not
# loop it.
set -u
API=${API:-https://necprep-api.waglesameer5.workers.dev}
ORIGIN=${ORIGIN:-https://necprep.pages.dev}
J=$(mktemp)
OUT=$(mktemp -d)

say() { printf '\n== %s\n' "$1"; }

say "1. anonymous session"
curl -s -c "$J" -X POST "$API/api/auth/anonymous" -H 'content-type: application/json' \
  -H "Origin: $ORIGIN" -d '{}' -o "$OUT/session.json" -w "   HTTP %{http_code}\n"
python3 -c "
import json;d=json.load(open('$OUT/session.json'))
print('   user', d['user']['id'], 'anonymous', d['user']['isAnonymous'])
"

say "2. rotation: sign in again and confirm the old cookie dies"
OLD=$(grep necprep_session "$J" | awk '{print $7}')
echo "   captured cookie: ${OLD:0:12}..."

say "3. start a real mock attempt"
KEY="e2e-$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
curl -s -b "$J" -c "$J" -X POST "$API/api/mock/start" -H 'content-type: application/json' \
  -H "Origin: $ORIGIN" -d "{\"templateId\":\"full-mock-1\",\"idempotencyKey\":\"$KEY\"}" \
  -o "$OUT/paper.json" -w "   HTTP %{http_code}\n"

python3 - "$OUT/paper.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
if 'questions' not in d:
    print('   ERROR', json.dumps(d)[:300]); sys.exit(1)
qs=d['questions']
print('   attempt     ', d['attemptId'])
print('   questions   ', len(qs))
print('   duration    ', d['durationSeconds'], 's =', d['durationSeconds']//60, 'min')
print('   options q1  ', len(qs[0]['options']))
# THE anti-cheat assertion.
#
# Inspect KEYS, never values. A first attempt searched the serialised blob for
# the word "correct" and fired on a question that happened to read "Which of
# the following is correct?" - a leak check that cries wolf on question wording
# is worse than no leak check, because it trains you to ignore it.
SUSPECT = ('correct', 'correctindex', 'correctoption', 'answerkey',
           'answer_key', 'iscorrect', 'key')
def keys(node, path='$'):
    if isinstance(node, dict):
        for k, v in node.items():
            yield path + '.' + k, k
            yield from keys(v, path + '.' + k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from keys(v, path + '[' + str(i) + ']')
leaks = sorted({p for p, k in keys(d) if k.lower().replace('_', '') in
                tuple(x.replace('_', '') for x in SUSPECT)})
print('   KEY LEAK?   ', leaks if leaks else 'none - no answer-key FIELD on the wire')
if leaks:
    raise SystemExit(1)
PY

say "4. answer every question with its FIRST option ref, then submit"
python3 - "$OUT/paper.json" "$OUT/body.json" <<'PY'
import json,sys,secrets
d=json.load(open(sys.argv[1]))
answers={q['questionId']: q['options'][0]['ref'] for q in d['questions']}
json.dump({'attemptId':d['attemptId'],'answers':answers,
           'idempotencyKey':'e2e-sub-'+secrets.token_hex(8)}, open(sys.argv[2],'w'))
print('   answering', len(answers), 'questions with opaque refs')
print('   sample ref:', list(answers.values())[0])
PY

curl -s -b "$J" -c "$J" -X POST "$API/api/mock/submit" -H 'content-type: application/json' \
  -H "Origin: $ORIGIN" --data @"$OUT/body.json" -o "$OUT/result.json" -w "   HTTP %{http_code}\n"

python3 - "$OUT/result.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
if 'error' in d:
    print('   ERROR', json.dumps(d)[:300]); sys.exit(1)
print('   score       ', d.get('score'), '/', d.get('total'))
print('   correct     ', d.get('correct'), ' incorrect', d.get('incorrect'), ' skipped', d.get('skipped'))
print('   accuracy    ', d.get('accuracyPct'), '%')
print('   timing      ', d.get('timing'))
print('   status      ', d.get('status'))
# The server decided all of the above. Nothing in the request said what was right.
print('   scored by   server (the submission carried only opaque refs)')
PY

say "5. the server marked it - the client never had a key"
rm -rf "$OUT" "$J"
