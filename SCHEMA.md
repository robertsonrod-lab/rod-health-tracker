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
                  "source": "label"|"estimate"|"not recorded", "photo": dataURL|null,
                  "pending"?: bool,            // photo meal awaiting an estimate
                  "mealId"?: str,              // groups items from one photo / HB1 code
                  "foodId"?: str, "qty"?: n, "qtyUnit"?: "serving"|"g"|"ml",   // link to My foods
                  "note"?: str, "fromHB"?: bool } ],
  "foods":    [ { "id", "name", "servingSize": n, "unit": "g"|"ml"|"piece",       // My foods; nutrition is PER SERVING
                  "cal": n, "protein": g|null, "fat": g|null, "carbs": g|null, "source": "label"|"estimate" } ],
  "dayNotes": { "YYYY-MM-DD": { "totalCal": n|null, "source", "note" } },        // legacy day totals without item values
  "peptides": [ { "id", "name", "mgPerMl": n, "vial", "plan" } ],
  "doses":    [ { "id", "peptideId", "date", "time": "HH:MM"|"", "mg": n, "note" } ],
  "schedule": [ { "peptideId", "date", "mg": n } ],
  "health":   [ { "id", "date", "text" } ],
  "profile":  [ { "id", "label", "value" } ],
  "importedCodes": [ "HB1:..." ]                                                  // used to warn about duplicate pastes
}
```

## Health Bot paste code (HB1)
A single token `HB1:` + base64url (RFC 4648 §5, no padding) of UTF-8 JSON. It may appear anywhere in pasted text.

```
{ "t": "meal", "d": "YYYY-MM-DD", "time"?: "HH:MM",
  "items": [ { "n": "name", "cal": integer, "p"?: protein_g, "src"?: "estimate"|"label" } ],
  "note"?: "text" }
```

The app attaches the items to the most recent photo meal awaiting an estimate on that date (asks if ambiguous),
or creates a new meal. Deep link form: `<app-url>#import=HB1:...` (opens in Safari; paste is the main path on iPhone,
because the home-screen app has separate storage).
