# ==============================================================================
# BAYESIAN SAMPLING SIZE CALCULATIONS (GIVEWELL CMAM VOI) - HKI
# ==============================================================================

library(tidyverse)
library(stats)
library(googlesheets4)
library(httr)

set_config(timeout(60))
options(scipen = 999) 

# ------------------------------------------------------------------------------
# STEP 1 : STUDY COSTS
# From our last estimation here: 
# ------------------------------------------------------------------------------
cost_data <- data.frame(
  N = c(2700, 11500, 14500, 20000),
  Total_Cost = c(1010567, 2345551, 2823729, 3612226)
)

cost_model <- lm(Total_Cost ~ N, data = cost_data)
fixed_cost <- coef(cost_model)[1]
marginal_cost_per_person <- coef(cost_model)[2]  

# ------------------------------------------------------------------------------
# STEP 2 : PROJECT COSTS
# Using tab HKI_VOI, etc,... column "8x bar for future opportunities" in this
# https://docs.google.com/spreadsheets/d/1g79b55nKK1xKo2xI04nOpkzJ3aNh99S2iDEefpPcGWg/edit?gid=383198313#gid=383198313
# ------------------------------------------------------------------------------
projects <- list(
  HKI = list(name = "HKI (Bauchi & Kebbi)", budget_upside = 28400000, budget_downside = 5400000),
  IMC = list(name = "IMC (Kano & Katsina)", budget_upside = 25600000, budget_downside = 4800000),
  PUI = list(name = "PUI (Katsina)",        budget_upside = 22700000, budget_downside = 1300000)
)

# ------------------------------------------------------------------------------
# STEP 3 : IMPORT PRIORS
# ------------------------------------------------------------------------------

##Counterfactual coverage
priors_df_HKI <- read_sheet("https://docs.google.com/spreadsheets/d/110xiVFS6v-SfDhjbpdZA-hc8WyJ4Ef1NLWCOsojhapM/edit?gid=734341534#gid=734341534",
                            sheet = "1. Priors SAM HKI", range = "A31:G71", col_names = TRUE) %>% 
  select(-c('...1', 'Group Average Points', 'Jordan\'s priors','totals')) %>%
  rename(Lower_Bound = Interval,
         Upper_Bound = ...3,
         Cumulative_Prob = 'Cumulative Probability') %>% 
  mutate(Lower_Bound = Lower_Bound /100,
         Upper_Bound = Upper_Bound /100)

##Caseload inflation
priors_caseload_HKI <- read_sheet("https://docs.google.com/spreadsheets/d/1zpaoNgFoOEYwcyatABwLty78NjgH1InstdeaYM3snzE/edit?gid=1075663808#gid=1075663808",
                            sheet = "Priors_HKI", range = "A15:AO17", col_names = FALSE) %>% 
  filter(...1 == "Researcher assigned probabilities") %>%
  select(-...1) %>%
  pivot_longer(cols = everything(), names_to = "bin_name", values_to = "prob") %>%
  mutate(
    prob = as.numeric(sub("%", "", prob)), 
    Lower_Bound = seq(0, 0.975, by = 0.025),
    Upper_Bound = seq(0.025, 1.0, by = 0.025),
    Cumulative_Prob = cumsum(prob)
  ) %>%
  select(Lower_Bound, Upper_Bound, Cumulative_Prob)

sample_empirical_prior <- function(n_sims, priors_df) {
  u <- runif(n_sims)
  breaks <- c(0, priors_df$Cumulative_Prob)
  bin_indices <- findInterval(u, breaks, rightmost.closed = TRUE, all.inside = TRUE)
  lower_bounds <- priors_df$Lower_Bound[bin_indices]
  upper_bounds <- priors_df$Upper_Bound[bin_indices]
  true_draws <- runif(n_sims, min = lower_bounds, max = upper_bounds)
  return(true_draws)
}


# ------------------------------------------------------------------------------
# STEP 4 : COST-EFFECTIVENESS MATH
# Here, I built a function to translate the priors on counterfactual coverage,
# into additional lives saved and into CE.
# Numbers are coming from tab Sims_HKI here
#https://docs.google.com/spreadsheets/d/1zpaoNgFoOEYwcyatABwLty78NjgH1InstdeaYM3snzE/edit?gid=1614701161#gid=1614701161
# ------------------------------------------------------------------------------
calculate_CE <- function(counterfactual_coverage, sam_caseload, mam_caseload, inflation_adj) {
  
  budget <- 1666667                                                             #Annual budget, cell B4
  val_per_death <- 119                                                          #Units of value per death averted, cell B19
  prop_mort_benefits <- 0.83                                                    #Proportion of benefits from mortality reduction, cell B20
  supp_adjustments <- 0.96                                                      #Supplemental adjustments, cell B21
  gd_value_per_dollar <- 0.003355                                               #Units of value per dollar, GiveDirectly: tab VOI_* in row 8
  
  sam_mort_untreated <- 0.094                                                   #Mortality rate if no SAM treatment, cell B10                                                    
  sam_mort_reduction <- 0.59                                                    #Mortality reduction for SAM children who would have gone untreated, cell B15
  mam_mort_untreated <- 0.036                                                   #Mortality rate if no MAM children, cell B11
  mam_mort_reduction <- 0.34                                                    #Mortality reduction for MAM children who would have gone untreated, cell B16
  marginal_mort_reduction <- 0.05                                               #Marginal mortality reduction in children who would have received gov treatment, cell B17 
  
  unique_sam <- sam_caseload * (1 - inflation_adj)                              #Correcting the number of SAM cases shared by HKI based on caseload inflation, cell row 8
  unique_mam <- mam_caseload * (1 - inflation_adj)                              #Correcting the number of MAM cases shared by HKI based on caseload inflation, cell row 9
  
  add_sam_treated <- unique_sam * (1 - counterfactual_coverage)                 #Counting the number of additional SAM treated children, cell row 13
  add_mam_treated <- unique_mam * (1 - counterfactual_coverage)                 #Counting the number of additional MAM treated children, cell row 14
  
  sam_deaths_averted_add <- add_sam_treated * sam_mort_untreated * sam_mort_reduction  #Counting the number of deaths averted from SAM, part of cell row 18
  mam_deaths_averted_add <- add_mam_treated * mam_mort_untreated * mam_mort_reduction  #Counting the number of deaths averted from MAM, other part of cell row 18 
  
  sam_treated_anyway <- unique_sam * counterfactual_coverage                    #Counting the number of children who would have been SAM treated anyway 
  mam_treated_anyway <- unique_mam * counterfactual_coverage                    #Counting the number of children who would have been MAM treated anyway
  
  sam_deaths_averted_marg <- sam_treated_anyway * sam_mort_untreated * marginal_mort_reduction #Correcting the number of deaths averted by the proportion of SAM children who would have received treatment from gov
  mam_deaths_averted_marg <- mam_treated_anyway * mam_mort_untreated * marginal_mort_reduction #Correcting the number of deaths averted by the proportion of MAM children who would have received treatment from gov
  
  total_deaths_averted <- sam_deaths_averted_add + mam_deaths_averted_add + 
    sam_deaths_averted_marg + mam_deaths_averted_marg                           #Total number of additional deaths averted, row 19.
  
  total_value <- (total_deaths_averted * val_per_death / prop_mort_benefits) * supp_adjustments #Units of value per deaths averted with some GW adjustments, numerator of row 22
  value_per_dollar <- total_value / budget                                      #Units of value per dollar spent, denominator of row 22
  ce_estimate_x_cash <- value_per_dollar / gd_value_per_dollar
  
  return(list(raw_ce = value_per_dollar, cash_ce = ce_estimate_x_cash))         #Actual CE estimates, cell B24
}

# ------------------------------------------------------------------------------
# STEP 5 : VOI SIMULATION FUNCTION
# ------------------------------------------------------------------------------
simulate_voi_for_N <- function(N, num_sims, program_budget, priors_df, priors_caseload_df) {
  
  # 1. The True World: Simulate the true counterfactual coverage
  true_p <- sample_empirical_prior(num_sims, priors_df)
  true_p <- pmax(0.0001, pmin(0.9999, true_p)) 
  
  # 2. Generate caseloads the same way Jordan did row 6
  sam_caseload <- pmax(0, rnorm(num_sims, mean = 10789, sd = 10789 * 0.30))
  mam_caseload <- pmax(0, rnorm(num_sims, mean = 10789, sd = 10789 * 0.30))
  
  inflation_adj <- sample_empirical_prior(num_sims, priors_caseload_df)         #Draw the coaseload inflation rate in this world
  unique_sam <- sam_caseload * (1 - inflation_adj)                              #Correct the number of caseload with inflation
  
  lga_pop <- pmax(0, rnorm(num_sims, mean = 309068, sd = 309068 * 0.20))        #Draw a total 6-59 months population in the LGAs where the program would operate, row 39
  catchment_prop <- pmax(0, pmin(1, rnorm(num_sims, mean = 0.35, sd = 0.35 * 0.30))) #Prop of the lga_pop residing in the program catchment area, row 40
  catchment_population <- lga_pop * catchment_prop                              #Target population in catchment area, row 41
  
  # 3. Translate True Counterfactual to True Coverage Change
  true_add_sam_treated <- unique_sam * (1 - true_p)                             #Count the number of additional children treated in this version of the world
  true_coverage_change <- true_add_sam_treated / catchment_population           #Calculate the true treatment coverage of HKI
  true_coverage_change <- pmax(0.0001, pmin(0.9999, true_coverage_change))
  
  # 4. The Survey (Measuring Coverage Change)
  study_se <- sqrt((true_coverage_change * (1 - true_coverage_change)) / N)     #The study SE will depend on the true treatment coverage of HKI (SE usual calculations for proportion)
  study_result <- rnorm(num_sims, mean = true_coverage_change, sd = study_se)   #We draw study results in the true world 
  
  # 5. Bayesian Update
  prior_mean_coverage <- mean(true_coverage_change)                             #We take the mean of the treatment coverage across all the different worlds
  prior_sd_coverage <- sd(true_coverage_change)                                 #We take the sd of the treatment coverage across all the different worlds
  
  prior_precision <- 1 / (prior_sd_coverage^2)                                  #To use in the Bayesian update: if the prior is precise, update is small (the prior is stubborn)
  study_precision <- 1 / (study_se^2)                                           #To use in the Bayesian update: if the study is precise, update is huge
  
  posterior_coverage_change <- ((prior_mean_coverage * prior_precision) + (study_result * study_precision)) / 
    (prior_precision + study_precision)                                         #Bayesian update
  
  # 6. Translate back to Posterior Counterfactual (for the CE math)
  posterior_add_sam_treated <- posterior_coverage_change * catchment_population #The posterior give me posterior treatment coverage after the study. I multiply it by the number of children in the catchment area to get the number of caseload reported by HKI.
  posterior_p <- 1 - (posterior_add_sam_treated / unique_sam)                   #We calculate the number of children who would have been treated anyway in this posterior world
  posterior_p <- pmax(0.0001, pmin(0.9999, posterior_p)) 
  
  # 7. Cost-Effectiveness 
  true_CE_results <- calculate_CE(true_p, sam_caseload, mam_caseload, inflation_adj)           #Translating the true counterfactual coverage for a given SAM and MAM caseload into CE
  posterior_CE_results <- calculate_CE(posterior_p, sam_caseload, mam_caseload, inflation_adj) #Translating the number of children who would have been treated anyway for a given SAM and MAM caseload into CE
  prior_only_CE_results <- calculate_CE(rep(mean(true_p), num_sims), sam_caseload, mam_caseload, inflation_adj) #Translating the no-survey estimate into CE
  
  target_ce_bar <- 8.0 
  
  # 8. Calculate Utilities (GiveDirectly Units of Value)
  gd_value_per_dollar <- 0.003355
  utility_scale_up <- program_budget$budget_upside * (true_CE_results$cash_ce - target_ce_bar) * gd_value_per_dollar #GW decides to fund the program for 10 years based on the survey results (in GD values)
  utility_scale_down <- program_budget$budget_downside * (true_CE_results$cash_ce - target_ce_bar) * gd_value_per_dollar #GW decides to stop funding based on the survey results (in GD values)
  
  # 9. The Uninformed Decision (GiveWell's Default Choice)
  uninformed_decision_is_scale_up <- mean(prior_only_CE_results$cash_ce) >= target_ce_bar
  
  if (uninformed_decision_is_scale_up) {                                        #Allocating budget based on uninformed decision
    utility_uninformed <- utility_scale_up
  } else {
    utility_uninformed <- utility_scale_down
  }
  
  # 10. The Informed Decision (Post-Study Choice)
  informed_decision_is_scale_up <- posterior_CE_results$cash_ce >= target_ce_bar
  utility_informed <- ifelse(informed_decision_is_scale_up, utility_scale_up, utility_scale_down) #Allocating budget based on informed decision
  
  # 11. True Expected Value of Information
  vois <- utility_informed - utility_uninformed                                 #Calculate the value of information in each simulation 
  total_expected_voi <- mean(vois)
  
  return(list(
    VoI = total_expected_voi,
    Avg_Raw_CE = mean(posterior_CE_results$raw_ce),                             #Value per dollar of the posterior                           
    Avg_Cash_CE = mean(posterior_CE_results$cash_ce)                            #CE of the posterior
  ))
}

# ------------------------------------------------------------------------------
# STEP 6 : FIND THE OPTIMAL SAMPLE SIZE
# ------------------------------------------------------------------------------
sample_sizes_to_test <- seq(100, 10000, by = 50) 
target_roi <- 8

cat("=== OPTIMAL SAMPLE SIZES (TARGET : MARGINAL ROI OF 8x) ===\n\n")

for (prog_name in c("HKI")) {
  prog <- projects[[prog_name]]
  
  results <- data.frame(N = numeric(), VoI = numeric(), Marginal_VoI = numeric(), 
                        Marginal_Cost = numeric(), Marginal_ROI = numeric(),
                        Expected_Raw_CE = numeric(), Expected_Cash_CE = numeric())
  
  prev_voi <- 0
  
  for (i in 1:length(sample_sizes_to_test)) {
    current_N <- sample_sizes_to_test[i]
    
    set.seed(40326) 
    
    sim_output <- simulate_voi_for_N(N = current_N, 
                                     num_sims = 100000, 
                                     program_budget = prog, 
                                     priors_df = priors_df_HKI,
                                     priors_caseload_df = priors_caseload_HKI) 
    
    current_voi <- sim_output$VoI
    
    if (i == 1) {
      marginal_voi <- current_voi                                               
      marginal_cost <- fixed_cost + (current_N * marginal_cost_per_person) 
    } else {
      step_size <- current_N - sample_sizes_to_test[i-1]
      marginal_voi <- current_voi - prev_voi
      marginal_cost <- step_size * marginal_cost_per_person                     #To measure by how much the VoI varies with sample size
    }
    
    gd_value_per_dollar <- 0.003355
    marginal_cost_units_of_value <- marginal_cost * gd_value_per_dollar         #Transforming the marginal cost of surveying 50 more households in GD value
    
    marginal_roi <- marginal_voi / marginal_cost_units_of_value
    
    results <- rbind(results, data.frame(N = current_N, 
                                         VoI = current_voi, 
                                         Marginal_VoI = marginal_voi, 
                                         Marginal_Cost = marginal_cost, 
                                         Marginal_ROI = marginal_roi,
                                         Expected_Raw_CE = sim_output$Avg_Raw_CE,
                                         Expected_Cash_CE = sim_output$Avg_Cash_CE))
    prev_voi <- current_voi
  }
  
  optimal_row <- results %>% filter(Marginal_ROI >= target_roi) %>% tail(1)     #To keep the row in the table that exceeds 8x   
  
  if(nrow(optimal_row) == 0) {
    cat(prog$name, ": Doesn't reach 8x ROI even at the smallest sample sizes.\n")
  } else {
    cat(prog$name, ": Optimal sample size for this project is", optimal_row$N, "households.\n") 
    cat("  Marginal ROI with this N : ", round(optimal_row$Marginal_ROI, 2), "x\n")
    cat("  Expected VoI: ", formatC(optimal_row$VoI, format="f", digits=0, big.mark=","), " Units of Value\n\n")
  }
}