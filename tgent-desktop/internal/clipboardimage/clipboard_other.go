//go:build !darwin

package clipboardimage

func Save() (string, error) {
	return "", nil
}

func ReadText() string {
	return ""
}
