# Merge rskj's verification components into powpeg's root metadata.
# Usage: awk -f merge-verification-metadata.awk <powpeg.xml> <rskj.xml> > merged.xml
# ARGV[1] = powpeg (root, gets the additions); ARGV[2] = rskj (source of truth).

FNR==1 { fileidx++ }                       # 1 = powpeg, 2 = rskj

# ---- pass 1: powpeg — buffer every line, remember existing component keys ----
fileidx==1 {
  line[n++] = $0
  if ($0 ~ /<component[ \t]/) have[compkey($0)] = 1
  next
}

# ---- pass 2: rskj — collect <component>…</component> blocks not already present ----
fileidx==2 {
  if (incomp) {                          # inside a multi-line block
      block = block "\n" $0
      if ($0 ~ /<\/component>/) {
          incomp = 0
          if (!(curkey in have)) add = add block "\n"
      }
      next
  }
  if ($0 ~ /<component[ \t]/) {
      curkey = compkey($0)
      if ($0 ~ /\/>[ \t]*$/) {           # self-closing one-liner
          if (!(curkey in have)) add = add $0 "\n"
      } else { incomp = 1; block = $0 }
  }
  next
}

# ---- emit powpeg, splicing the additions in front of </components> ----
END {
  for (i = 0; i < n; i++) {
      if (line[i] ~ /<\/components>/ && add != "") printf "%s", add
      print line[i]
  }
}

function compkey(s) { return attr(s,"group") ":" attr(s,"name") ":" attr(s,"version") }
function attr(s, a,   m) {
  if (match(s, a "=\"[^\"]*\"")) {
      m = substr(s, RSTART, RLENGTH); sub(a "=\"", "", m); sub(/"$/, "", m)
      return m
  }
  return ""
}
