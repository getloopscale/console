module github.com/usetheo/theo/cloud

go 1.25.0

require (
	github.com/go-chi/chi/v5 v5.2.5
	github.com/usetheo/theo/pkg v0.0.0-00010101000000-000000000000
)

require (
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/lib/pq v1.12.3
)

replace github.com/usetheo/theo/pkg => ../pkg
