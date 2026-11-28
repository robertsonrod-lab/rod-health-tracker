# Data formats

## Backup / import file (JSON)
Exported from More → Export backup, loaded with More → Import data.

```
{
  "version": 1,
  "settings": { "goal": kg|null, "height": cm|null, "age": n|null, "sex": "male"|"female", "activity": "sedentary|light|moderate|very|extra",
                "calMin": n, "calMax": n, "protein": g, "bandLow": kg|null, "bandHigh": kg|null },
  "weights":  [ { "id", "date": "YYYY-MM-DD", "kg": n } ],                       // one per date; latest re-weigh wins
  "food":     [ { "id", "date", "time"?: "HH:MM", "item", "cal": n|null, "protein": g|null,
                  "source": "label"|"estimate"|"not recorded"|"typical", "photo": dataURL|null,
                  "pending"?: bool,            // photo meal awaiting an estimate
                  "mealId"?: str,              // groups items from one photo / HB1 code
                  "foodId"?: str, "qty"?: n, "qtyUnit"?: "serving"|"g"|"ml"|"piece",
                  "basisCal"?: n, "basisProtein"?: n, "basisQty"?: n, "basisUnit"?: str, // so editing amount rescales
                  "note"?: str, "fromHB"?: bool } ],
  "foods":    [ { "id", "name", "basis": "100"|"serving"|"unit",  // what cal/protein are for
                  "servingSize": n, "unit": "g"|"ml"|"piece",
                  "cal": n|null, "protein": g|null, "fat": g|null, "carbs": g|null,
                  "source": "label"|"estimate"|"typical" } ],
  "dayNotes": { "YYYY-MM-DD": { "totalCal": n|null, "source", "note" } },        // legacy day totals without item values
  "peptides": [ { "id", "name", "mgPerMl": n, "vial", "plan" } ],
  "doses":    [ { "id", "peptideId", "date", "time": "HH:MM"|"", "mg": n, "note" } ],
  "schedule": [ { "peptideId", "date", "mg": n } ],
  "health":   [ { "id", "date", "text" } ],
  "profile":  [ { "id", "label", "value" } ],
  "importedCodes": [ "HB1:..." ]                                                  // used to warn about duplicate pastes
}
```

Existing My foods entries that have no `basis` are treated as `serving` (nutrition already stored per serve). Logged items keep working if they have no quantity.

A built-in catalogue (`foods.json`, typical AUSNUT/USDA-style reference values, not personal) is shipped with the app and suggested as you type. It is not written into localStorage. A personal My foods entry with the same name (case/whitespace-insensitive, also matching aliases) takes priority. Customising a built-in saves a copy in My foods.

On launch, and after import, HB1 paste, or a new food log entry, the app scans logged items and adds any distinct name not already in My foods or the built-in list. It does not overwrite existing My foods. Placeholder names such as "Meal photo" are skipped.

A built-in peptide catalogue (`peptides.json`, generic public reference data, not personal) is shipped with the app and appears in the dose-log picker and syringe presets. A personal peptide with the same name (case/whitespace-insensitive, also matching aliases) takes priority and is never overwritten. Typical dose, frequency and "commonly used for" text appear on the Doses tab as factual reference figures only. Evidence notes and the general “not medical advice” statement live on the Disclaimers tab, in an expandable section for each built-in peptide. Choosing a built-in peptide and logging a dose, building a schedule, or saving an edit stores a personal copy in localStorage; existing logged doses keep their original peptide ids.

## Health Bot paste code (HB1)
A single token `HB1:` + base64url (RFC 4648 §5, no padding) of UTF-8 JSON. It may appear anywhere in pasted text.

```
{ "t": "meal", "d": "YYYY-MM-DD", "time"?: "HH:MM",
  "items": [ { "n": "name", "cal": integer, "p"?: protein_g, "src"?: "estimate"|"label",
               "q"?: amount, "u"?: "g"|"ml"|"piece"|"serving",
               "per"?: basis_amount, "pu"?: basis_unit } ],
  "note"?: "text" }
```

`cal` / `p` are for the estimated amount `q` (default 1 serving if `q` is omitted). The app shows an amount box defaulting to `q`, and unedited pastes save the same calories. Old codes without `q` remain valid.

The app attaches the items to the most recent photo meal awaiting an estimate on that date (asks if ambiguous),
or creates a new meal. Deep link form: `<app-url>#import=HB1:...` (opens in Safari; paste is the main path on iPhone,
because the home-screen app has separate storage).
