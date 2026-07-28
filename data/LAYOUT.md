# DOF Supplemental Market Value Roll — official layout

Source: NYC Department of Finance, `layout-supplemental-market-value-roll.xlsx`.

## Official surcharge criteria (DOF)

> The surcharge applies to certain properties in New York City that are not
> used as a primary residence. For property tax years 2026-27 and 2027-28,
> the surcharge may apply to:
>
> - One-, two-, and three-family homes valued by DOF at more than $5 million
> - Condominium and cooperative units valued by DOF at $1 million or more
>
> The surcharge will generally not apply if the property is used as a primary
> residence by the owner, a tenant or immediate family member of the owner,
> or one or more individuals with a majority interest in an entity that owns
> the property.

> The Department of Finance published a supplemental market value roll on
> July 24, 2026, related to the annual non-primary residence property
> surcharge. This roll includes, but is not limited to, those properties that
> may be subject to the surcharge. This roll will be open for public
> inspection and examination until December 31, 2026.

| Field | Description | Notes |
|---|---|---|
| PARID | Parcel Identifier | Combination of boro, block, lot, and easement |
| BORO | Borough | 1 Manhattan, 2 Bronx, 3 Brooklyn, 4 Queens, 5 Staten Island |
| BLOCK | Block | Valid ranges — Manhattan 1–2255, Bronx 2260–5958, Brooklyn 1–8955, Queens 1–16350, Staten Island 1–8050 |
| LOT | Lot | Unique within BORO/BLOCK |
| TAXYR | Tax Year | 2027 |
| RECTYPE | Record Type | `1` = Ordinary Real Estate, `U` = Co-op unit |
| TAX_CLASS | Tax Class | |
| BLDG_CLASS | Building Class | e.g. C0 |
| OWNER | Owner's Name | |
| HOUSENUM_LO | Lowest house number | |
| HOUSENUM_HI | Highest house number | |
| STREET_NAME | Street name | |
| APT_NO | Apartment number | |
| ZIP_CODE | Zip code | |
| CITYNAME | City name | |
| COOP_BLDG_NUM | Co-op building number | |
| COOP_BLDG_SUFFIX | Co-op building suffix | |
| COOP_NUM | Co-op development identifier | |
| CONDO_NUMBER | Condo identification number | |
| FMV | **Final Market Assessed Total Value** | Whole dollars |

Pipeline note: co-op unit records (`RECTYPE='U'`) repeat their building's BBL;
our import suffixes their `parid` (e.g. `1000110014-U0001`) to keep a unique PK.
