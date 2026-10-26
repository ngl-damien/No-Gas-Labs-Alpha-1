#!/usr/bin/env python3
import sys
step=int(sys.argv[1])
if not 1 <= step <= 12: raise SystemExit("step outside 1..12")
print((940*step)//12)
