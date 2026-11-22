// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// theoEnvName matches a string literal that starts an environment variable
// name with the pre-rename THEO_ prefix.
var theoEnvName = regexp.MustCompile(`"THEO_[A-Z0-9_]*"`)

// The loopzero Helm chart (getloopscale/loopzero charts/loopzero-cloud) sets
// this binary's own settings under the LOOPZERO_ prefix. A read under the old
// THEO_ prefix never sees the chart's value and silently falls back to a
// default: that is how staging ran in dev mode with a random service secret
// per pod (getloopscale/console#523). Every read in the binary's source must
// use the chart's names.
func TestBinaryReadsNoTheoPrefixedEnvironmentVariables(t *testing.T) {
	var offenders []string
	for _, root := range []string{".", "../internal"} {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for i, line := range strings.Split(string(src), "\n") {
				if m := theoEnvName.FindString(line); m != "" {
					offenders = append(offenders, path+":"+strconv.Itoa(i+1)+" "+m)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", root, err)
		}
	}
	if len(offenders) > 0 {
		t.Errorf("the binary reads THEO_-prefixed variables the chart never sets; use LOOPZERO_:\n%s", strings.Join(offenders, "\n"))
	}
}
