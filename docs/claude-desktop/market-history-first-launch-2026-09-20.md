# Market Claude Desktop history on first launch

## Failure and source audit

On Claude Desktop 2.2553.1, an isolated Market profile loaded its Code roster at
22:10:24 with no catalog directory. ORG2 copied 93 rows at 22:10:25–22:10:28,
after Desktop had finished initializing. Desktop's session manager reads its
catalog during initialization; activating the existing process does not reload
it. The empty Code page was therefore compatible with complete files on disk.

The installed vendor source was inspected read-only, without executing bundled
code or calling private IPC. Relevant SHA-256 digests:

| Vendor bundle member                  | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `.vite/build/index.chunk-ChZ67Jhw.js` | `f707495cb51c99e7c74180278a1dd0798540136d1acde4a3ed3ce66d926038bf` |
| `.vite/build/index.chunk-l0PS_wmg.js` | `d7b669cc33878d3f660390397bb35a641fbe46b6a948ef11f2e31a2d129c0892` |

The local Gateway storage account is the installation UUID in `ant-did`, encoded
with standard Base64. The vendor reads an existing file or generates a random
UUID when absent. The local Gateway organization is
`00000000-0000-4000-8000-000000000001`. This is a local installation identity,
not an authenticated account or permission grant. The real profile's decoded
installation UUID matched the account directory used in Desktop's load log.

## Change and boundaries

For the audited release only, ORG2 creates the installation identity in its own
isolated profile if absent, then copies resumable history before dispatching
Desktop. Publication is atomic and does not replace an existing identity.
Existing `ant-did` must agree with vendor account metadata; a missing or
conflicting identity in an existing profile is rejected rather than replaced.
Existing organization metadata remains authoritative. Other
compatible releases retain the previous vendor-discovery path until their
namespace contract is verified. No credential, trust grant, permission mode,
or primary installation identity is inherited.

New discovery filenames use the Desktop session ID, which can differ from the
CLI transcript UUID. Desktop loads each discovered filename into memory using
the JSON session ID; opening/sending uses that in-memory record and the CLI
transcript ID. This is why existing mismatched filenames do not prevent the
initial list or continuation. Metadata saves, deletes, and exports use the
Desktop ID filename. Existing rows and transcripts are retained unchanged,
including older mismatched copies: a later vendor save can create the canonical
filename while leaving the legacy duplicate. Archive/delete behavior for those
old duplicate records remains unverified; this change does not silently rename,
delete, or overwrite historical data.

A profile already running with an empty in-memory roster needs one normal quit
and reopen. ORG2 does not stop that process or interrupt current Code/Cowork
work. Subsequent cold starts see the prepared catalog. Pure terminal sessions
without a Desktop discovery row are outside this change.

## Lifecycle and verification

| Area            | Verdict | Evidence and decision                                                                          | Verification                                                                          |
| --------------- | ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work | keep    | Work remains in the explicit Open app action; no new timer or watcher                          | Source trace: prepare → import → dispatch                                             |
| Memory/I/O      | keep    | Existing 512-row, 1.5 GiB/pass, 128 MiB/transcript and 15-second copy bounds remain            | Existing boundary tests plus targeted regression suite                                |
| Scope/isolation | fix     | Identity and catalog are confined to the selected Market profile; primary catalog is read-only | First-open, invalid identity, link refusal, no-overwrite and repeated import fixtures |
| Rendering       | fix     | First roster is present before the vendor startup read                                         | Filesystem regression; native first-launch UI rerun still pending                     |

| Provider       | Raw transition                   | App state                           | Boundary               | Expected invariant                                           | Evidence                                             |
| -------------- | -------------------------------- | ----------------------------------- | ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Claude Desktop | Initial history import           | First launch, no vendor config yet  | Local isolated profile | Discovery row and resumable transcript exist before dispatch | Regression fixture                                   |
| Claude Desktop | Repeated import                  | Reopen                              | Local isolated profile | Same identity, no duplicate row, no overwritten continuation | Regression fixture                                   |
| Claude Desktop | Desktop ID differs from CLI UUID | Import                              | Discovery writer       | Filename matches Desktop ID; transcript keeps CLI ID         | Regression fixture                                   |
| Claude Desktop | Actual startup                   | Current user profile running Cowork | Vendor UI              | Existing history is visibly loaded after cold restart        | Not rerun: ongoing user work must not be interrupted |

Performance verdict: blocked on native first-launch/idle measurement. No claim
of completed end-to-end UI acceptance is made from filesystem tests alone.

## Architecture review

The owning boundary is the native Open app dispatcher. Fresh and existing
profiles share the same transcript preparation and additive catalog writer;
only namespace discovery differs. Installation identity, authenticated identity,
Desktop session ID, and CLI transcript ID remain separate concepts. Unknown
Desktop releases use existing discovery behavior rather than assumed namespace
compatibility. Wire-shaped discovery rows retain only the existing descriptive
allowlist and reset permission fields. No core provider abstraction, network
protocol, retained cache, or frontend subscription changes. Compilation and
regression results are recorded in the pull request; native GUI evidence is
explicitly separate from filesystem publication evidence.
