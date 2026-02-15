library(Rserve)

cat("Starting test Rserve app ...\n")

wrap.r.fun <- Rserve:::ocap

oc.init <- function() {
    cat("init ...\n")
    wrap.r.fun(function() {
        list(
            add = wrap.r.fun(function(a, b) a + b),
            greet = wrap.r.fun(function(name) paste0("Hello, ", name, "!")),
            test = wrap.r.fun(function(x) 1 + 1)
        )
    })
}

# WebSocket on 8081 (where Traefik routes), QAP on 6311 (for health checks).
Rserve::run.Rserve(
    websockets.port = 8081,
    websockets = TRUE,
    oob = TRUE,
    websockets.qap.oc = TRUE
)
