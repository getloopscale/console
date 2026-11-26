// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

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

// loopscaleEnvName matches a string literal that starts an environment variable
// name with the pre-rename LOOPSCALE_ prefix.
var loopscaleEnvName = regexp.MustCompile(`"LOOPSCALE_[A-Z0-9_]*"`)

// The loop-runtime Helm chart (getloopscale/loop-runtime charts/loop-console) sets
// this binary's own settings under the LOOP_RUNTIME_ prefix. A read under the old
// LOOPSCALE_ prefix never sees the chart's value and silently falls back to a
// default: that is how staging ran in dev mode with a random service secret
// per pod (getloopscale/loop-console#523). Every read in the binary's source must
// use the chart's names.
func TestBinaryReadsNoLoopScalePrefixedEnvironmentVariables(t *testing.T) {
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
				if m := loopscaleEnvName.FindString(line); m != "" {
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
		t.Errorf("the binary reads LOOPSCALE_-prefixed variables the chart never sets; use LOOP_RUNTIME_:\n%s", strings.Join(offenders, "\n"))
	}
}
