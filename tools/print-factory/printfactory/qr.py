"""QR geometry inputs. Pure Python - runs on the system interpreter, not Blender.

Scannability is the whole product here. Three rules are load-bearing:
  - quiet zone: 4 blank modules on every side, or cameras will not lock on
  - module size: >=1.6mm so a 0.4mm nozzle resolves each cell
  - ECC H: a print artefact must not destroy the code
"""
import segno

QUIET_ZONE = 4
MIN_MODULE_MM = 1.6

def qr_matrix(payload: str, ecc: str = "h") -> list[list[int]]:
    if not payload:
        raise ValueError("payload must not be empty")
    qr = segno.make(payload, error=ecc)
    rows = [[1 if c else 0 for c in row] for row in qr.matrix]
    n = len(rows)
    w = n + QUIET_ZONE * 2
    out = [[0] * w for _ in range(QUIET_ZONE)]
    for r in rows:
        out.append([0] * QUIET_ZONE + r + [0] * QUIET_ZONE)
    out.extend([[0] * w for _ in range(QUIET_ZONE)])
    return out

def plaque_size_mm(payload: str, module_mm: float = MIN_MODULE_MM,
                   ecc: str = "h") -> float:
    if module_mm < MIN_MODULE_MM:
        raise ValueError(
            f"module_mm {module_mm} below {MIN_MODULE_MM}: will not scan when printed")
    return len(qr_matrix(payload, ecc)) * module_mm
