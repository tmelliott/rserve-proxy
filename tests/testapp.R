library(Rserve)

cat("Starting test Rserve app ...\n")

wrap.r.fun <- Rserve:::ocap

oc.init <- function() {
    cat("init ...\n")
    wrap.r.fun(function() {
        list(
            add = wrap.r.fun(function(a, b) a + b),
            greet = wrap.r.fun(function(name) paste0("Hello, ", name, "!")),
            test = wrap.r.fun(function(x) 1 + 1),
            hungry_job = wrap.r.fun(function(N, R) {
                rn <- rnorm(N)
                # compute bootstrap mean and variance
                samples <- replicate(R, sample(rn, replace = TRUE))
                bootMean <- mean(samples)
                bootVar <- var(samples)
                c(bootMean, bootVar)
            })
        )
    })
}

# run.Rserve() is called automatically by the platform — no need to call it here.
