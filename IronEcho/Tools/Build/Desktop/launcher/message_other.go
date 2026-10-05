//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
)

func message(title, text string) {
	fmt.Fprintf(os.Stderr, "%s\n%s\n(Enter to continue)\n", title, text)
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
