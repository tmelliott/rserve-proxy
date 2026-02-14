library(Rserve)

cat("connected to Rserve\n")

oc.init <- function() {
    cat("init ...\n")
    wrap.f.fun(function() {
        list(test = Rserve:::ocap(function(x) 1 + 1))
    })
}
Rserve::run.Rserve(
    websockets.port = 6311,
    websockets = TRUE,
    oob = TRUE,
    qap = FALSE,
    websockets.qap.oc = TRUE
)
