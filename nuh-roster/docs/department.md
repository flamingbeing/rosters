# NUH Roster: the department

Part of [NOTES.md](../NOTES.md). Useful to any app in the repo that deals with NUH anaesthesia staff or rosters.

## People

- **Seniors**, in seniority order: SC (senior consultant), C (consultant), VC (visiting consultant), AC (associate consultant), RP (resident physician).
- **Juniors**, in seniority order: Senior resident, Junior resident, RP, Locum, MOPEX, Rotating resident.
  - A registrar is a Senior resident (a junior).
  - RP appears in both lists: resident physicians can be rostered as either.
- Staff lists sort by role (seniors first), then seniority, then name.
- **Colours on the roster:**
  - Seniors are always black.
  - Green marks a "Baby MO": a new MOPEX who is never left alone, so their senior never double covers.
  - Purple marks a locum.
- **Junior postings,** with the tag written after the name on the roster:

  | Posting | Tag |
  |---|---|
  | Paeds | P |
  | Neuro | Neu |
  | Special Risk | SR |
  | Cardiac | Cardiac |
  | ENT | ENT |
  | Regional | RA |
  | Vascular | Vasc |
  | Ambulatory | Amb |
  | Remote | Remote |
  | PACU | PACU |
  | Liver Transplant | L |
  | Liver Donor | HPB |

  - Postings rotate, so juniors who aren't on the staff list are skipped by default when importing the contact list.
  - Postings change by the week (Monday to Sunday) and are planned for the year: Monthly › Rotations. A junior can be moved for a single day from their person box ("Posting today").
- **Short names** are how the leave and post call lists write people:
  - surname first: "Koh Yi Wen" → "Koh YW"
  - one given name after the surname: "Lim Xinyi" → "Xinyi"
  - common, mostly English, given name first: initial and surname, "Rebecca Chua Hui Min" → "R Chua", "Rebecca Victoria Lau Rui Xin" → "R Lau"
  - anything else: the first name, "Anjali Varma" → "Anjali"

## The daily roster sheet

One Excel sheet per day (columns A–L), which the app reproduces exactly (`js/layout.js`):

- **Title band:** "DEPARTMENT OF ANAESTHESIA / NATIONAL UNIVERSITY HEALTH SYSTEM", shaded grey across A–K.
- **Date row**, and the **comments box** at I5. The box runs down to the Cardiac Call row, leaving a gap row above the AIC box. It holds meetings and people away, plus comments added to names.
- **MOT and SICU call teams:**
  - MOT: Consultant, Registrar/AC, Residents MO1–MO3.
  - SICU: Consultant, Registrar/AC, MO1 only.
- **Specialist / Assistants rows:**
  - EOT 8 and EOT 9: these default to the MOT call team.
  - Epidural: specialist; Day float (DF) and Night float (NF) on two rows.
  - Cardiac Call: senior and junior, who by default do MOR 12.
  - AOCC: one senior and two juniors, taken after the OT lists.
  - AIC: one consultant (SC/C), else a Senior resident, in a box.
  - Pain/ACP Clinic, Acute Pain and Chronic Pain.
- **Admin/no list, Post call and Leave grids:** nine names per row (C–K).
  - Anyone working but on no list goes on Admin/no list.
  - People on MC go on the Leave row.
- **AH OT row** in blue, then the **OT rows**, in this order:
  - Remote 1 and 2 (labels in red)
  - KROR PACU, KROR 1–7
  - MCOR PACU, MCOR 1–10
  - ECT
  - MBOR PACU, MOR 1–6 and 10–18

  MOR 7–9 are emergency OTs and get no line. Every row has senior, junior and premed columns; case notes are not exported.
- **Notation in a cell:**
  - "Name (L)": liver standby.
  - "Name L-4pm" or "L-4-5pm": leaving early. Whoever covers the room is written "Name C-OT13" (or "C-KROR PACU"); C- can point to any room or PACU.
  - "Name (C)" in red: an ad hoc cover, with nobody physically there.
  - "Name -mtg 3pm": a comment, which also goes into the comments box.
  - "&" (superscript after a senior): double covering.
  - "Name - Premed" in the premed column.
  - "(AOH)": added by hand only.
  - Posting tags as in the table above.

## Rules the department works by

- **Seniors:** subspecialty lists (paeds, cardiac, neuro, thoracic by default) only go to seniors with that subspec. Seniors can be marked as not doing certain lists. MOR 12 and MOR 13 are cardiac by default.
- **Double cover:** only when seniors are short, only within one complex, and never on complex lists or with a Baby MO.
- **Juniors:**
  - Residents get the harder cases.
  - Posting matches are preferred.
  - Baby MOs are never alone.
  - The liver standby junior and senior (from the Liver roster) are kept off complex lists.
  - A junior can't be in two rooms at once: one of the rooms becomes an ad hoc cover "(C)". That is preferred to leaving an OT with no junior, but each junior covers at most one extra room.
- **Premed cover:** needed when a room's junior wasn't around on the previous working day (on leave, MC or post call). Any resident or MOPEX who was around can do it, from any complex, up to a per-person cap.
- **Post call:** the day after an overnight duty. The default duties are R1–R3, Night Float, S1 1pm–8:30am, Epidural (N), SICU MO and ICU Registrar; they can be changed in Settings.

## The monthly rosters (HMS exports)

HMS (the hospital's system) exports monthly rosters as PDFs. Each has a title "Anaesthesia - … Roster For Oct 2022" and the same layout every month. The app reads them with pdf.js using text positions (`js/monthly.js`). It also reads Excel copies in the same layout and exports that layout back.

| Roster (title) | Columns | Feeds |
|---|---|---|
| Junior On Call | R1, R2, R3, Day Float, Night Float · R/SR/AC Stay-in S1 (8:30am–1pm), S1 (1pm–8:30am), Anaesthesia Referral, Epidural (D), Epidural (N) · SICU MO, ICU Registrar | MOT MO1–3; Epidural DF/NF and specialist (Epidural (D)); MOT Registrar/AC (S1 1pm); SICU MO1 and Registrar; post call |
| Senior On Call | Cons S3, C1, C2, C3 (MO), Tee Cons · SICU Cons | MOT Consultant; Cardiac Call (C1 senior, C3 junior); SICU Consultant |
| Liver Transplant | OT (Junior), OT (Senior), ICU, Donor | liver standby (L) for the OT senior and junior |
| Leave | Name, Leave Period ("1 Oct - 4 Oct", "6 Oct"), Leave Type, Remarks | leave; Medical Leave is MC |
| Night List (After Office Hr) | AOH, AOH Standby, Extended List (Senior/Junior) | shown on Today only |
| Pain | typed in the app | Pain/ACP, Acute and Chronic Pain rows |

- Two Junior roster columns share the heading "R/SR/AC Stay-in S1"; they are told apart left to right.
- Names in the exports are written in many ways ("LOKE BENJAMIN", "Quah Zi Hui, Bernice", "Ng Kai []"). They are matched to the staff list by name and short names, and unmatched ones show in red.

## Other inputs

- **Admin draft roster** (.xlsx, the sheet layout above, filled in by the admin team): rooms running, case notes, leave, post call and the upper-half duties. Loaded on Cases.
- **Department contact list** (.xlsx), uploaded monthly. Only names, grade groups (column C) and subspecialties are read. Phone numbers, MCR, emails and employee numbers are never read or stored. Names lose titles ("Dr", "A/Prof") and "Surname Given, Nick" is reordered.
