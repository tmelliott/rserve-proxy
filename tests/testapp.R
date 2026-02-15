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

# run.Rserve() is called automatically by the platform — no need to call it here.
